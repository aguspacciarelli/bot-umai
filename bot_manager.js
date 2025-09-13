require("dotenv").config()
const { deployBot, monitorBot, restartBot } = require("./ssh_connector")

// Lista de archivos a desplegar
const FILES_TO_DEPLOY = [
  "index.js",
  "database.js",
  "package.json",
  ".env",
  // Añade aquí cualquier otro archivo que necesite tu bot
]

// Función para procesar argumentos de línea de comandos
async function main() {
  const args = process.argv.slice(2)
  const command = args[0]?.toLowerCase()

  switch (command) {
    case "deploy":
      console.log("Iniciando despliegue del bot...")
      await deployBot(FILES_TO_DEPLOY)
      break

    case "monitor":
      console.log("Monitoreando el estado del bot...")
      await monitorBot()
      break

    case "restart":
      console.log("Reiniciando el bot...")
      const success = await restartBot()
      console.log(success ? "Reinicio exitoso." : "Hubo problemas durante el reinicio.")
      break

    default:
      console.log(`
=== Bot Manager ===
Uso: node bot-manager.js [comando]

Comandos disponibles:
  deploy  - Despliega el bot en el servidor remoto
  monitor - Muestra el estado actual del bot
  restart - Reinicia el bot en el servidor

Ejemplos:
  node bot-manager.js deploy
  node bot-manager.js monitor
  node bot-manager.js restart
      `)
  }
}

// Ejecutar la función principal
main().catch((error) => {
  console.error("Error en bot-manager:", error)
  process.exit(1)
})
