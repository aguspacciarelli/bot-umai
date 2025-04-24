require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { connectDB, getDB } = require('./database');
const { ObjectId } = require('mongodb');

const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
];

const client = new Client({ intents });

client.once('ready', async () => {
    console.log(`¡Bot conectado como ${client.user.tag}!`);
    try {
        await connectDB(process.env.MONGODB_URI, 'datos_bot');
    } catch (error) {
        console.error('Error al conectar a la base de datos:', error);
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Comando !botiano para mostrar el menú
    if (message.content.startsWith('!botiano')) {
        const saludoBotiano = `¡Hola ${message.author.username}! :) Soy botiano, tu bot académico de UMAI.\nAquí tienes una lista de los comandos disponibles:\n\n`;
        const comandosBotiano = [
            `\`!pregunta <tu_pregunta>\`: Realiza una pregunta académica. Intentaré buscar la respuesta en mi base de datos.`,
            // Agrega aquí más comandos a medida que los implementes
        ];
        await message.reply({ content: saludoBotiano + comandosBotiano.join('\n') });
        return; // Detener el procesamiento adicional del mensaje
    }

    // Verificar si el bot fue mencionado y el mensaje NO comienza con '!pregunta'
    if (message.mentions.users.has(client.user.id) && !message.content.startsWith('!pregunta')) {
        const saludoMencion = `¡Hola ${message.author.username}! :) Parece que me mencionaste. Si tienes una pregunta académica, usa el comando \`!pregunta <tu_pregunta>\`. Si quieres ver la lista de comandos, usa \`!botiano\`.`;
        await message.reply({ content: saludoMencion });
        return; // Detener el procesamiento adicional del mensaje
    }

    // Resto de la lógica para el comando !pregunta
    if (message.content.startsWith('!pregunta')) {
        const preguntaUsuario = message.content.slice('!pregunta'.length).trim();
        if (preguntaUsuario) {
            try {
                const db = getDB();
                const preguntasCollection = db.collection('preguntas_frecuentes');

                // Lógica de sugerencias (tu código existente)
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
                        sugerencias.push({ _id: preguntaDB._id, pregunta: preguntaDB.pregunta, coincidencias });
                    }
                }

                sugerencias.sort((a, b) => b.coincidencias - a.coincidencias);

                if (sugerencias.length > 0) {
                    const filasDeBotones = [];
                    let botonesEnFila = [];

                    for (let i = 0; i < Math.min(numSugerencias, sugerencias.length); i++) {
                        const sugerencia = sugerencias[i];
                        const boton = new ButtonBuilder()
                            .setCustomId(`pregunta_sugerida_${sugerencia._id}`)
                            .setLabel(sugerencia.pregunta.slice(0, 80) + (sugerencia.pregunta.length > 80 ? '...' : ''))
                            .setStyle(ButtonStyle.Primary);

                        botonesEnFila.push(boton);
                        if (botonesEnFila.length === 5 || i === Math.min(numSugerencias, sugerencias.length) - 1) {
                            filasDeBotones.push(new ActionRowBuilder().addComponents(botonesEnFila));
                            botonesEnFila = [];
                        }
                    }

                    await message.reply({
                        content: 'Quizás quisiste preguntar:',
                        components: filasDeBotones,
                    });
                } else {
                    const preguntaEscapada = escapeRegExp(preguntaUsuario);
                    const resultado = await preguntasCollection.findOne({ pregunta: { $regex: new RegExp(preguntaEscapada, 'i') } });

                    if (resultado) {
                        message.reply(resultado.respuesta);
                    } else {
                        message.reply('Perdón, no tengo la respuesta a esa pregunta en este momento :(');
                    }
                }
            } catch (error) {
                console.error('Error al buscar o sugerir preguntas:', error);
                message.reply('Hubo un error al procesar tu pregunta.');
            }
        } else {
            message.reply('Por favor, incluye tu pregunta después del comando `!pregunta`.');
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('pregunta_sugerida_')) {
        const preguntaId = interaction.customId.split('pregunta_sugerida_')[1];
        try {
            const db = getDB();
            const preguntasCollection = db.collection('preguntas_frecuentes');
            const resultado = await preguntasCollection.findOne({ _id: new ObjectId(preguntaId) });

            if (resultado) {
                await interaction.reply({ content: `**${resultado.pregunta}**\n${resultado.respuesta}`, ephemeral: false });
            } else {
                await interaction.reply({ content: 'La pregunta sugerida ya no está disponible.', ephemeral: true });
            }
        } catch (error) {
            console.error('Error al buscar la respuesta de la pregunta sugerida:', error);
            await interaction.reply({ content: 'Hubo un error al obtener la respuesta.', ephemeral: true });
        }
    }
});

// Funciones auxiliares (tokenize y escapeRegExp)
function tokenize(text) {
    return text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

client.login(process.env.DISCORD_TOKEN);