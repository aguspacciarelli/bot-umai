//Bibliotecas
require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const fs = require("fs"); // Módulo para interactuar con el sistema de archivos
const { ObjectId } = require("mongodb");
const { connectDB, getDB } = require("./database");


//Eventos de los que el bot deberá recibir información
const intents = [
  GatewayIntentBits.Guilds, //Server
  GatewayIntentBits.GuildMessages, //Mensajes
  GatewayIntentBits.MessageContent, //Contenido de los mensajes
];

const client = new Client({ intents }); //Instancia que va a utilizar el bot para interactuar con DS

//Conexión a la base de datos y conecta al bot
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
  //if (message.author.bot) return; Ignora mensajes de otro bot

  // comando !botiano para mostrar el menú
  if (message.content.startsWith("!botiano")) {
    const saludoBotiano = `¡Hola ${message.author.username}! :) Soy botiano, tu bot académico de UMAI.\nAquí tienes una lista de los comandos disponibles:\n\n`;

    const comandosBotiano = [
      `\`!pregunta <tu_pregunta>\`: Realiza una pregunta académica. Intentaré buscar la respuesta en mi base de datos.`,
      `\`!reservas [carrera]\`: Muestra las reservas de aulas. Puedes especificar una carrera (ej: \`!reservas multimedia\`, \`!reservas videojuegos\`) o dejarlo vacío para ver todas.`,
    ];

    await message.reply({
      content: saludoBotiano + comandosBotiano.join("\n"),
    });

    return; // Detener el procesamiento adicional del mensaje
  } // Verificar si el bot fue mencionado y el mensaje NO comienza con '!pregunta'

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
          message.reply("Hubo un error interno al conectar con la base de datos. Por favor, inténtalo de nuevo más tarde.");
          return;
        }

        const preguntasCollection = db.collection("preguntas_frecuentes"); // sugerencias

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

        message.reply("Hubo un error al procesar tu pregunta.");
      }
    } else {
      message.reply(
        "Por favor, incluye tu pregunta después del comando `!pregunta`."
      );
    }
  }

  // Comando !reservas (modificado para filtrar solo por carrera)
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
      const filtroCarrera = args[0] || null; // Captura el término de filtro de carrera

      let currentReservations = [];
      let filtroAplicadoTexto = ""; // Para el mensaje de respuesta

      // --- Definiciones de palabras clave por carrera ---
      const palabrasClaveMultimedia = ["multimedia", "multi", "tecnologia", "tecnologia multimedial"];
      const palabrasClaveVideojuegos = ["videojuegos", "video juegos"];

      // --- Lógica de filtrado por carrera ---
      if (filtroCarrera) {
        if (palabrasClaveMultimedia.includes(filtroCarrera)) {
          filtroAplicadoTexto = `para Multimedia`;
          currentReservations = reservas.filter(reserva => {
            const textoReservaNormalizado = Object.values(reserva)
              .filter(value => typeof value === 'string')
              .map(value => normalizeText(value))
              .join(' ');
            const multimediaRegex = new RegExp(palabrasClaveMultimedia.map(k => normalizeText(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), "i");
            return multimediaRegex.test(textoReservaNormalizado);
          });
        } else if (palabrasClaveVideojuegos.includes(filtroCarrera)) {
          filtroAplicadoTexto = `para Videojuegos`;
          currentReservations = reservas.filter(reserva => {
            const textoReservaNormalizado = Object.values(reserva)
              .filter(value => typeof value === 'string')
              .map(value => normalizeText(value))
              .join(' ');
            const videojuegosRegex = new RegExp(palabrasClaveVideojuegos.map(k => normalizeText(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), "i");
            return videojuegosRegex.test(textoReservaNormalizado);
          });
        } else {
          // Si se especificó un argumento pero no es una carrera válida
          await message.reply(`Filtro de carrera inválido: "${filtroCarrera}". Por favor, usa: \`multimedia\` o \`videojuegos\`.`);
          return;
        }
      } else {
        // Si no se especificó ningún filtro de carrera, se usa el filtro general de palabras clave (tu `filtrarReservasPorPalabrasClave` original)
        currentReservations = filtrarReservasPorPalabrasClave(reservas);
        filtroAplicadoTexto = "disponibles (categorías principales)";
      }

      let finalReservations = currentReservations;

      if (finalReservations.length === 0) {
        await message.reply(`No se encontraron reservas ${filtroAplicadoTexto} que coincidan con los criterios.`);
        return;
      }

      let respuesta = `**Reservas ${filtroAplicadoTexto}:**\n\n`;

      finalReservations.forEach((reserva, index) => {
        const startDate = new Date(reserva.startDate);
        const endDate = new Date(reserva.endDate);

        const fecha = startDate.toLocaleDateString('es-ES', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });

        const horaInicio = startDate.toLocaleTimeString('es-ES', {
          hour: '2-digit',
          minute: '2-digit'
        });

        const horaFin = endDate.toLocaleTimeString('es-ES', {
          hour: '2-digit',
          minute: '2-digit'
        });

        respuesta += `${index + 1}. **${reserva.resourceName}** - ${fecha} (${horaInicio} a ${horaFin})\n`;
        respuesta += `    ${reserva.title} - ${reserva.description}\n\n`;
      });

      if (respuesta.length > 2000) {
        const chunks = respuesta.match(/.{1,1900}/gs);
        for (const chunk of chunks) {
          await message.channel.send(chunk);
        }
      } else {
        await message.reply(respuesta);
      }
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
              content: "Hubo un error interno al conectar con la base de datos. Por favor, inténtalo de nuevo más tarde.",
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
  //cadena de texto en minúscula, elimina caractéres, divide la palabra y filtra
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

//escapa de los caractéres especiales
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
        "tecnologia",
        "tecnologia multimedial",
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


client.login(process.env.DISCORD_TOKEN);