//Bibliotecas

require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const { connectDB, getDB } = require("./database");

const { ObjectId } = require("mongodb");

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

  if (message.content.startsWith("!reservas")) {
    const fs = require("fs"); // Module to interact with the file system
  
    const rutaArchivo = "/home/dawi/DOCKER/apiAulas/data/reservations.json"; // Absolute path to the file on the VPS
  
    try {
      // Read the file synchronously as text
      const data = fs.readFileSync(rutaArchivo, "utf8");
  
      // Parse the text as JSON to convert it to an array of objects
      const reservas = JSON.parse(data);
  
      // If the file is empty or there are no reservations
      if (!reservas.length) {
        message.reply("No hay reservas registradas actualmente.");
      return;
      }
  
      // Format the response in a readable way
      let respuesta = "**Reservas Actuales:**\n\n";
  
      // Loop through each reservation and add it to the response
      reservas.forEach((reserva, index) => {
        // Convert UTC dates to local time format
        const startDate = new Date(reserva.startDate);
        const endDate = new Date(reserva.endDate);
        
        // Format date as DD/MM/YYYY
        const fecha = startDate.toLocaleDateString('es-ES', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
        
        // Format times as HH:MM
        const horaInicio = startDate.toLocaleTimeString('es-ES', {
          hour: '2-digit',
          minute: '2-digit'
        });
        
        const horaFin = endDate.toLocaleTimeString('es-ES', {
          hour: '2-digit',
          minute: '2-digit'
        });
        
        // Add the reservation to the response
        respuesta += `${index + 1}. **${reserva.resourceName}** - ${fecha} (${horaInicio} a ${horaFin})\n`;
        respuesta += `   ${reserva.title} - ${reserva.description}\n\n`;
      });
  
      // If the message is too long, split it into multiple messages
      if (respuesta.length > 2000) {
        const chunks = respuesta.match(/.{1,1900}/gs); // Split into chunks of 1900 characters
        for (const chunk of chunks) {
          await message.channel.send(chunk);
        }
      } else {
        await message.reply(respuesta);
      }
    } catch (error) {
      console.error("Error al leer o procesar el archivo de reservas:", error);
      message.reply("Hubo un error al acceder a las reservas. Por favor, inténtalo de nuevo más tarde.");
    }
  }
})

 

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith("pregunta_sugerida_")) {
    const preguntaId = interaction.customId.split("pregunta_sugerida_")[1];

    try {
      const db = getDB();

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

client.login(process.env.DISCORD_TOKEN);
