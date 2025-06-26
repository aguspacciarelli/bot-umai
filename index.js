//Bibliotecas
require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require("discord.js");
const fs = require("fs");
const { ObjectId } = require("mongodb");
const { connectDB, getDB } = require("./database");

//Eventos de los que el bot deberá recibir información
const intents = [
  GatewayIntentBits.Guilds, //Server
  GatewayIntentBits.GuildMessages, //Mensajes
  GatewayIntentBits.MessageContent, //Contenido de los mensajes
];

const client = new Client({ intents });

//Conexión a la base de datos y conexión con el bot
client.once("ready", async () => {
  console.log(`¡Bot conectado como ${client.user.tag}!`);
  try {
    await connectDB(process.env.MONGODB_URI, "datos_bot");
    console.log("Conectado a MongoDB desde database.js");
  } catch (error) {
    console.error("Error al conectar a la base de datos:", error);
  }
});

client.on("messageCreate", async (message) => {

  if (message.content.startsWith("!botiano")) {
    const saludoBotiano = `¡Hola ${message.author.username}! :) Soy botiano, tu bot académico de UMAI.\nAcá tenés una lista de los comandos disponibles:\n\n`;

    const comandosBotiano = [
      `\`!pregunta <tu_pregunta>\`: Haceme una pregunta académica. Voy a intentar buscar la respuesta en mi base de datos.`,
      `\`!reservas <día>\`: Muestra las reservas de aulas para el día de la semana especificado (ej: \`!reservas lunes\`.`,
    ];

    await message.reply({
      content: saludoBotiano + comandosBotiano.join("\n"),
    });

    return;
  }

  if (
    message.mentions.users.has(client.user.id) &&
    !message.content.startsWith("!pregunta")
  ) {
    const saludoMencion = `¡Hola ${message.author.username}! :) Parece que me mencionaste. Si tienes una pregunta académica, usa el comando \`!pregunta <tu_pregunta>\`. Si quieres ver la lista de comandos, usa \`!botiano\`.`;

    await message.reply({ content: saludoMencion });

    return;
  }

  if (message.content.startsWith("!pregunta")) {
    const preguntaUsuario = message.content.slice("!pregunta".length).trim();

    if (preguntaUsuario) {
      try {
        const db = getDB();
        if (!db) {
          console.error("No se pudo obtener la instancia de la base de datos.");
          message.reply("Hubo un error interno. Por favor, intentalo de nuevo más tarde.");
          return;
        }

        const preguntasCollection = db.collection("preguntas_frecuentes"); // Sugerencias

        const preguntasEnDB = await preguntasCollection.find().toArray();

        const tokensUsuario = tokenize(preguntaUsuario);

        const sugerencias = [];

        const numSugerencias = 3;

        for (const preguntaDB of preguntasEnDB) {
          const tokensDB = tokenize(preguntaDB.pregunta);

          let coincidencias = 0;

          for (const tokenUsuario of tokensUsuario) {
            if (tokensDB.includes(tokenUsuario)) {
              coincidencias++;
            }
          }

          if (coincidencias > 0) {
            sugerencias.push({
              _id: preguntaDB._id,
              pregunta: preguntaDB.pregunta,
              coincidencias,
            });
          }
        }

        sugerencias.sort((a, b) => b.coincidencias - a.coincidencias);

        if (sugerencias.length > 0) {
          const filasDeBotones = [];

          let botonesEnFila = [];

          for (
            let i = 0;
            i < Math.min(numSugerencias, sugerencias.length);
            i++
          ) {
            const sugerencia = sugerencias[i];

            const boton = new ButtonBuilder()
              .setCustomId(`pregunta_sugerida_${sugerencia._id}`)
              .setLabel(
                sugerencia.pregunta.slice(0, 80) +
                  (sugerencia.pregunta.length > 80 ? "..." : "")
              )
              .setStyle(ButtonStyle.Primary);

            botonesEnFila.push(boton);

            if (
              botonesEnFila.length === 5 ||
              i === Math.min(numSugerencias, sugerencias.length) - 1
            ) {
              filasDeBotones.push(
                new ActionRowBuilder().addComponents(botonesEnFila)
              );

              botonesEnFila = [];
            }
          }

          await message.reply({
            content: "Quizás quisiste decir:",

            components: filasDeBotones,
          });
        } else {
          const preguntaEscapada = escapeRegExp(preguntaUsuario);

          const resultado = await preguntasCollection.findOne({
            pregunta: { $regex: new RegExp(preguntaEscapada, "i") },
          });

          if (resultado) {
            message.reply(resultado.respuesta);
          } else {
            message.reply(
              "Perdón, no tengo la respuesta a esa pregunta en este momento :("
            );
          }
        }
      } catch (error) {
        console.error("Error al buscar o sugerir preguntas:", error);

        message.reply("Hubo un error al procesar tu pregunta :(");
      }
    } else {
      message.reply(
        "Por favor, incluí tu pregunta después del comando `!pregunta`."
      );
    }
  }

  if (message.content.startsWith("!reservas")) {
    const rutaArchivo = "/home/dawi/DOCKER/apiAulas/data/reservations.json"; // Ruta absoluta al archivo en la VPS

    try {
      const data = fs.readFileSync(rutaArchivo, "utf8");
      const dataObj = JSON.parse(data);
      let reservas = dataObj.data.reservations;

      if (!Array.isArray(reservas) || reservas.length === 0) {
        message.reply("No hay reservas registradas actualmente.");
        return;
      }

      const args = message.content.slice("!reservas".length).trim().toLowerCase().split(" ");
      const filtroDiaUsuario = args[0] || null; // Captura el término de filtro (tiene que ser un día)

      const diasSemana = {
        'domingo': 0, 'lunes': 1, 'martes': 2, 'miercoles': 3, 'miércoles': 3,
        'jueves': 4, 'viernes': 5, 'sabado': 6, 'sábado': 6
      };

      let currentReservations = [];
      let filtroAplicadoTexto = ""; // Para el mensaje de respuesta

      if (!filtroDiaUsuario || !diasSemana.hasOwnProperty(filtroDiaUsuario)) {
        await message.reply("Para ver las reservas, por favor, especifica un día de la semana. Por ejemplo: `!reservas lunes`.");
        return;
      }

      const diaNumero = diasSemana[filtroDiaUsuario];
      const fechaObjetivo = getNextWeekdayDate(diaNumero, new Date()); // Obtenemos la fecha del día más próximo

   
      const optionsWeekday = { weekday: 'long' };
      const nombreDiaCompleto = fechaObjetivo.toLocaleDateString('es-ES', optionsWeekday);

    
      const diaCapitalizado = nombreDiaCompleto.charAt(0).toUpperCase() + nombreDiaCompleto.slice(1);

      const optionsDate = { day: '2-digit', month: '2-digit' };
      const fechaCorta = fechaObjetivo.toLocaleDateString('es-ES', optionsDate);

      filtroAplicadoTexto = `${diaCapitalizado}, ${fechaCorta}`;
    

      currentReservations = reservas.filter(reservation => {
        const fechaReserva = new Date(reservation.startDate);
        return fechaReserva.getDate() === fechaObjetivo.getDate() &&
               fechaReserva.getMonth() === fechaObjetivo.getMonth() &&
               fechaReserva.getFullYear() === fechaObjetivo.getFullYear();
      });

      let finalReservations = filtrarReservasPorPalabrasClave(currentReservations);


      if (finalReservations.length === 0) {
        await message.reply(`No se encontraron reservas para ${filtroAplicadoTexto} que coincidan con los criterios o con las categorías principales.`);
        return;
      }

    
      const embed = new EmbedBuilder()
        .setColor(0xB66C54) // Color
        .setTitle(`📅Reservas para ${filtroAplicadoTexto}`)
        .setDescription('Aulas reservadas:')


      finalReservations.forEach((reserva) => {
        const startDateAdjusted = new Date(reserva.startDate);
        startDateAdjusted.setHours(startDateAdjusted.getHours() - 3);

        const horaInicio = startDateAdjusted.toLocaleTimeString('es-ES', {
          hour: '2-digit',
          minute: '2-digit'
        });

        embed.addFields({
          name: `⏰${horaInicio} - ${reserva.description}`,
          value: reserva.resourceName,
          inline: false
        });
      });

      await message.reply({ embeds: [embed] });

    } catch (error) {
      console.error("Error al leer o procesar el archivo de reservas:", error);
      await message.reply("Hubo un error al acceder a las reservas. Por favor, inténtalo de nuevo más tarde.");
    }
  }
});


client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith("pregunta_sugerida_")) {
    const preguntaId = interaction.customId.split("pregunta_sugerida_")[1];

    try {
      const db = getDB();
      if (!db) {
          console.error("No se pudo obtener la instancia de la base de datos para interacción.");
          await interaction.reply({
              content: "Hubo un error interno. Por favor, intentalo de nuevo más tarde :(",
              ephemeral: true
          });
          return;
      }

      const preguntasCollection = db.collection("preguntas_frecuentes");
      const resultado = await preguntasCollection.findOne({
        _id: new ObjectId(preguntaId),
      });

      if (resultado) {
        await interaction.reply({
          content: `**${resultado.pregunta}**\n${resultado.respuesta}`,
          ephemeral: false,
        });
      } else {
        await interaction.reply({
          content: "La pregunta sugerida ya no está disponible.",
          ephemeral: true,
        });
      }
    } catch (error) {
      console.error(
        "Error al buscar la respuesta de la pregunta sugerida:",
        error
      );
      await interaction.reply({
        content: "Hubo un error al obtener la respuesta.",
        ephemeral: true,
      });
    }
  }
});

function tokenize(text) {
  // Cadena de texto en minúscula, elimina caractéres, divide la palabra y filtra
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

// Escapa de los caractéres especiales
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normaliza una cadena de texto para la comparación (quita tildes y convierte a minúsculas).
 * @param {string} text La cadena de texto a normalizar.
 * @returns {string} La cadena de texto normalizada.
 */
function normalizeText(text) {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Filtra un arreglo de objetos de reserva, devolviendo solo aquellos que contengan
 * alguna de las palabras clave especificadas en cualquiera de sus campos de texto.
 * La búsqueda es insensible a mayúsculas/minúsculas y a tildes.
 *
 * @param {Array<Object>} reservas El arreglo de objetos de reserva.
 * @returns {Array<Object>} Un nuevo arreglo con las reservas filtradas.
 */

function filtrarReservasPorPalabrasClave(reservas) {
    const palabrasClave = [
        "css",
        "multimedia",
        "videojuegos",
        "video juegos",
        "multi",
        "multimedial",
    ];

    const regexPattern = palabrasClave
        .map(keyword => normalizeText(keyword))
        .map(keyword => keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');

    const combinedRegex = new RegExp(regexPattern, "i");

    return reservas.filter(reserva => {
        const textoReservaNormalizado = Object.values(reserva)
            .filter(value => typeof value === 'string')
            .map(value => normalizeText(value))
            .join(' ');

        return combinedRegex.test(textoReservaNormalizado);
    });
}

/**
 * Obtiene la fecha del día de la semana más próxima (hoy o en los próximos 7 días).
 * @param {number} targetDay El día de la semana deseado (0=Domingo, 1=Lunes, ..., 6=Sábado).
 * @param {Date} referenceDate La fecha de referencia para calcular el día más próximo (normalmente new Date()).
 * @returns {Date} La fecha del día de la semana más próximo.
 */
function getNextWeekdayDate(targetDay, referenceDate = new Date()) {
    const today = new Date(referenceDate);
    today.setHours(0, 0, 0, 0); // Establecer a medianoche para comparar solo fechas

    const currentDay = today.getDay();
    let daysToAdd = targetDay - currentDay;

    if (daysToAdd < 0) {
        daysToAdd += 7;
    }

    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + daysToAdd);
    return nextDate;
}

client.login(process.env.DISCORD_TOKEN);