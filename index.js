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
      `\`!reservas [carrera|día]\`: Muestra las reservas de aulas. Puedes especificar una carrera (ej: \`!reservas multimedia\`, \`!reservas videojuegos\`) o un día (ej: \`!reservas lunes\`).`,
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

  // Comando !reservas (modificado para filtrar por día O por carrera)
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
      const filtroUsuario = args[0] || null; // Captura el término de filtro (día o carrera)

      let currentReservations = [];
      let tipoFiltro = "todas"; // 'todas', 'dia', 'carrera'
      let filtroAplicadoTexto = ""; // Para el mensaje de respuesta

      // --- Definiciones de filtros ---
      const diasSemana = {
        'domingo': 0, 'lunes': 1, 'martes': 2, 'miercoles': 3, 'miércoles': 3,
        'jueves': 4, 'viernes': 5, 'sabado': 6, 'sábado': 6
      };

      const palabrasClaveMultimedia = ["multimedia", "multi", "tecnologia", "tecnologia multimedial"];
      const palabrasClaveVideojuegos = ["videojuegos", "video juegos"];

      // --- Lógica de filtrado ---
      if (filtroUsuario) {
        // Intentar filtrar por día
        if (diasSemana.hasOwnProperty(filtroUsuario)) {
          tipoFiltro = "dia";
          const diaNumero = diasSemana[filtroUsuario];
          const fechaObjetivo = getNextWeekdayDate(diaNumero, new Date()); // Obtenemos la fecha del día más próximo

          // Formateamos la fecha objetivo para el título del mensaje
          const options = { weekday: 'long', day: '2-digit', month: '2-digit' };
          filtroAplicadoTexto = `- ${fechaObjetivo.toLocaleDateString('es-ES', options).replace(/\b\w/g, char => char.toUpperCase()).replace('De ', 'de ')}`;

          currentReservations = reservas.filter(reservation => {
            const fechaReserva = new Date(reservation.startDate);
            // Comparamos solo la fecha (día, mes, año)
            return fechaReserva.getDate() === fechaObjetivo.getDate() &&
                   fechaReserva.getMonth() === fechaObjetivo.getMonth() &&
                   fechaReserva.getFullYear() === fechaObjetivo.getFullYear();
          });

        }
        // Intentar filtrar por carrera: Multimedia
        else if (palabrasClaveMultimedia.includes(filtroUsuario)) {
          tipoFiltro = "carrera";
          filtroAplicadoTexto = `para Multimedia`;
          currentReservations = reservas.filter(reserva => {
            const textoReservaNormalizado = Object.values(reserva)
              .filter(value => typeof value === 'string')
              .map(value => normalizeText(value))
              .join(' ');
            const multimediaRegex = new RegExp(palabrasClaveMultimedia.map(k => normalizeText(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), "i");
            return multimediaRegex.test(textoReservaNormalizado);
          });
        }
        // Intentar filtrar por carrera: Videojuegos
        else if (palabrasClaveVideojuegos.includes(filtroUsuario)) {
          tipoFiltro = "carrera";
          filtroAplicadoTexto = `para Videojuegos`;
          currentReservations = reservas.filter(reserva => {
            const textoReservaNormalizado = Object.values(reserva)
              .filter(value => typeof value === 'string')
              .map(value => normalizeText(value))
              .join(' ');
            const videojuegosRegex = new RegExp(palabrasClaveVideojuegos.map(k => normalizeText(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), "i");
            return videojuegosRegex.test(textoReservaNormalizado);
          });
        }
        // Filtro inválido
        else {
          await message.reply(`Filtro inválido: "${filtroUsuario}". Por favor, usa un día de la semana (lunes, martes, etc.) o una carrera (multimedia, videojuegos).`);
          return;
        }
      } else {
        // Si no se especificó ningún filtro, se usan todas las reservas filtradas por categorías principales
        currentReservations = filtrarReservasPorPalabrasClave(reservas);
        filtroAplicadoTexto = "disponibles (categorías principales)";
      }

      let finalReservations = currentReservations;
      // Si el filtro fue por día o no hubo filtro, aplicamos el filtro de palabras clave generales también.
      // Si el filtro fue por carrera, `currentReservations` ya está filtrado por la carrera específica.
      if (tipoFiltro === "dia" || tipoFiltro === "todas") {
          finalReservations = filtrarReservasPorPalabrasClave(currentReservations);
      }


      if (finalReservations.length === 0) {
        await message.reply(`No se encontraron reservas ${filtroAplicadoTexto} que coincidan con los criterios.`);
        return;
      }

      // --- Construcción de la respuesta en bloque de código ansi (para el color verde) ---
      let respuestaBloque = `[2;36m📅 Reservas ${filtroAplicadoTexto}:\n\n`; // Comienza con código ANSI para color azul claro/cian, similar al verde en tu imagen

      finalReservations.forEach((reserva) => {
        // CREAR UNA NUEVA INSTANCIA DE FECHA PARA CADA RESERVA Y RESTAR LAS HORAS
        const startDateAdjusted = new Date(reserva.startDate);
        startDateAdjusted.setHours(startDateAdjusted.getHours() - 3); // Restar 3 horas

        const horaInicio = startDateAdjusted.toLocaleTimeString('es-ES', { // Usar la fecha ajustada
          hour: '2-digit',
          minute: '2-digit'
        });

        // Formato como en la imagen: ⏰ 09:00 - Negocios Digitales\nSala: Aula 508
        respuestaBloque += `[2;33m⏰ ${horaInicio} - ${reserva.title}\n`; // ⏰ en amarillo
        respuestaBloque += `[2;35mSala: ${reserva.resourceName}\n\n`; // Sala en magenta (o puedes probar otros colores)
      });

      // Asegúrate de cerrar el bloque de código
      respuestaBloque = "```ansi\n" + respuestaBloque + "```";

      // Discord tiene un límite de 2000 caracteres por mensaje.
      // Si la respuesta es muy larga, divídela en chunks.
      if (respuestaBloque.length > 2000) {
        // En caso de que sea muy larga, se envía como texto plano sin formato ANSI
        let respuestaNormal = `**Reservas ${filtroAplicadoTexto}:**\n\n`;
        finalReservations.forEach((reserva, index) => {
          // Ajustar también aquí si se usa la versión normal
          const startDateAdjusted = new Date(reserva.startDate);
          startDateAdjusted.setHours(startDateAdjusted.getHours() - 3); // Restar 3 horas

          const fecha = startDateAdjusted.toLocaleDateString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          });

          const horaInicio = startDateAdjusted.toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit'
          });

          const horaFin = new Date(reserva.endDate); // Aquí la fecha de fin no se ajusta, considerar si necesitas ajustar también endDate
          horaFin.setHours(horaFin.getHours() - 3);

          respuestaNormal += `${index + 1}. **${reserva.resourceName}** - ${fecha} (${horaInicio} a ${horaFin.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })})\n`;
          respuestaNormal += `    ${reserva.title} - ${reserva.description}\n\n`;
        });

        const chunks = respuestaNormal.match(/.{1,1900}/gs);
        for (const chunk of chunks) {
          await message.channel.send(chunk);
        }
      } else {
        await message.reply(respuestaBloque);
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

/**
 * Obtiene la fecha del día de la semana más próxima (hoy o en los próximos 7 días).
 * @param {number} targetDay El día de la semana deseado (0=Domingo, 1=Lunes, ..., 6=Sábado).
 * @param {Date} referenceDate La fecha de referencia para calcular el día más próximo (normalmente new Date()).
 * @returns {Date} La fecha del día de la semana más próximo.
 */
function getNextWeekdayDate(targetDay, referenceDate = new Date()) {
    const today = new Date(referenceDate);
    today.setHours(0, 0, 0, 0); // Establecer a medianoche para comparar solo fechas

    const currentDay = today.getDay(); // 0 (Domingo) - 6 (Sábado)
    let daysToAdd = targetDay - currentDay;

    // Si el día objetivo ya pasó esta semana, súmale 7 para ir a la próxima semana
    // O si el día objetivo es hoy, pero ya pasó la hora del cálculo original.
    // Para simplificar, si el día objetivo es igual al día actual y ya pasó, o si es un día anterior,
    // se va a la siguiente semana.
    if (daysToAdd < 0) {
        daysToAdd += 7;
    }

    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + daysToAdd);
    return nextDate;
}

client.login(process.env.DISCORD_TOKEN);