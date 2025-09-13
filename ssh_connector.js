require("dotenv").config()
const NodeSSH = require("node-ssh")
const fs = require("fs")
const path = require("path")

// Configuración SSH
const serverIP = process.env.SSH_IP
const sshUser = process.env.SSH_USER
const sshPassword = process.env.SSH_PASS

// Configuración del despliegue
const REMOTE_DIR = process.env.REMOTE_DIR || "/home/user/botiano" // Directorio remoto configurable desde .env
const BOT_NAME = process.env.BOT_NAME || "botiano" // Nombre del proceso en PM2

// Configuración de conexión
const CONNECTION_TIMEOUT = 30000 // 30 segundos
const MAX_RETRY_ATTEMPTS = 3
const RETRY_DELAY = 5000 // 5 segundos

/**
 * Conecta al servidor SSH con reintentos automáticos
 * @param {number} retryCount - Número de intentos realizados
 * @returns {Promise<NodeSSH>} - Cliente SSH conectado
 */
async function connectSSH(retryCount = 0) {
  try {
    console.log(`Intento ${retryCount + 1} de conexión SSH a ${serverIP}...`)
    const ssh = new NodeSSH()

    await ssh.connect({
      host: serverIP,
      username: sshUser,
      password: sshPassword,
      timeout: CONNECTION_TIMEOUT,
      // Para usar clave SSH en lugar de contraseña, descomenta la siguiente línea:
      // privateKey: '/ruta/a/tu/clave/privada',
    })

    console.log("Conexión SSH establecida exitosamente.")
    return ssh
  } catch (error) {
    console.error(`Error al conectar por SSH (intento ${retryCount + 1}):`, error.message)

    // Reintentar si no hemos alcanzado el número máximo de intentos
    if (retryCount < MAX_RETRY_ATTEMPTS - 1) {
      console.log(`Reintentando en ${RETRY_DELAY / 1000} segundos...`)
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY))
      return connectSSH(retryCount + 1)
    }

    throw new Error(`No se pudo establecer conexión SSH después de ${MAX_RETRY_ATTEMPTS} intentos: ${error.message}`)
  }
}

/**
 * Ejecuta un comando en el servidor SSH
 * @param {NodeSSH} sshClient - Cliente SSH conectado
 * @param {string} command - Comando a ejecutar
 * @returns {Promise<Object>} - Resultado del comando
 */
async function executeCommandSSH(sshClient, command) {
  if (!sshClient) {
    throw new Error("Cliente SSH no inicializado")
  }

  try {
    console.log(`Ejecutando comando: ${command}`)
    const result = await sshClient.execCommand(command)

    if (result.stderr && !result.stdout) {
      console.warn("Advertencia en la ejecución del comando:", result.stderr)
    }

    return result
  } catch (error) {
    console.error("Error al ejecutar el comando SSH:", error.message)
    throw error
  }
}

/**
 * Cierra la conexión SSH
 * @param {NodeSSH} sshClient - Cliente SSH a desconectar
 */
async function disconnectSSH(sshClient) {
  if (sshClient) {
    try {
      sshClient.dispose()
      console.log("Conexión SSH cerrada correctamente.")
    } catch (error) {
      console.error("Error al cerrar la conexión SSH:", error.message)
    }
  }
}

/**
 * Despliega el bot en el servidor remoto
 * @param {Array<string>} files - Lista de archivos a desplegar
 * @returns {Promise<void>}
 */
async function deployBot(files = ["index.js", "database.js", "package.json", ".env"]) {
  let ssh = null

  try {
    console.log(`Iniciando despliegue de ${BOT_NAME}...`)

    // Conectar al servidor SSH
    ssh = await connectSSH()

    // Crear directorio remoto si no existe
    await executeCommandSSH(ssh, `mkdir -p ${REMOTE_DIR}`)

    // Transferir archivos
    for (const file of files) {
      if (fs.existsSync(file)) {
        console.log(`Transfiriendo ${file}...`)
        await ssh.putFile(path.resolve(file), `${REMOTE_DIR}/${path.basename(file)}`)
      } else {
        console.warn(`Advertencia: El archivo ${file} no existe y será omitido.`)
      }
    }

    // Transferir este archivo también
    await ssh.putFile(path.resolve(__filename), `${REMOTE_DIR}/${path.basename(__filename)}`)

    console.log("Archivos transferidos correctamente")

    // Instalar dependencias
    console.log("Instalando dependencias...")
    await executeCommandSSH(ssh, `cd ${REMOTE_DIR} && npm install`)

    // Configurar PM2
    await setupPM2(ssh)

    console.log("¡Despliegue completado con éxito!")
  } catch (error) {
    console.error("Error durante el despliegue:", error)
  } finally {
    // Cerrar la conexión SSH
    if (ssh) {
      await disconnectSSH(ssh)
    }
  }
}

/**
 * Configura PM2 en el servidor
 * @param {NodeSSH} ssh - Cliente SSH conectado
 * @returns {Promise<void>}
 */
async function setupPM2(ssh) {
  try {
    console.log("Configurando PM2...")

    // Verificar si PM2 está instalado, si no, instalarlo
    await executeCommandSSH(ssh, "npm list -g pm2 || npm install -g pm2")

    // Crear directorio de logs
    await executeCommandSSH(ssh, `mkdir -p ${REMOTE_DIR}/logs`)

    // Configuración para PM2
    const PM2_CONFIG = {
      name: BOT_NAME,
      script: "index.js",
      cwd: REMOTE_DIR,
      autorestart: true,
      watch: false,
      max_memory_restart: "200M",
      env: {
        NODE_ENV: "production",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "logs/error.log",
      out_file: "logs/output.log",
      merge_logs: true,
      time: true,
    }

    // Crear archivo de configuración PM2
    console.log("Creando archivo de configuración PM2...")
    const configContent = JSON.stringify({ apps: [PM2_CONFIG] }, null, 2)
    await ssh.putContent(configContent, `${REMOTE_DIR}/ecosystem.config.json`)

    // Iniciar/Reiniciar el bot con PM2
    console.log(`Iniciando ${BOT_NAME} con PM2...`)
    await executeCommandSSH(
      ssh,
      `cd ${REMOTE_DIR} && pm2 delete ${BOT_NAME} || true && pm2 start ecosystem.config.json`,
    )

    // Configurar PM2 para iniciar en el arranque del sistema
    console.log("Configurando PM2 para iniciar en el arranque del sistema...")
    await executeCommandSSH(ssh, "pm2 save && pm2 startup")

    console.log("¡Configuración de PM2 completada con éxito!")
  } catch (error) {
    console.error("Error durante la configuración de PM2:", error)
    throw error
  }
}

/**
 * Monitorea el estado del bot
 * @returns {Promise<Object>} - Información del monitoreo
 */
async function monitorBot() {
  let ssh = null
  const monitorInfo = {
    status: null,
    logs: null,
    resources: null,
  }

  try {
    console.log(`Conectando al servidor para monitorear ${BOT_NAME}...`)

    // Conectar al servidor SSH
    ssh = await connectSSH()

    // Verificar estado de PM2
    console.log(`Verificando estado de ${BOT_NAME}...`)
    const statusResult = await executeCommandSSH(ssh, "pm2 status")
    console.log("Estado de PM2:")
    console.log(statusResult.stdout)
    monitorInfo.status = statusResult.stdout

    // Verificar logs recientes
    console.log("\nÚltimas 10 líneas de logs:")
    const logsResult = await executeCommandSSH(ssh, `pm2 logs ${BOT_NAME} --lines 10 --nostream`)
    console.log(logsResult.stdout)
    monitorInfo.logs = logsResult.stdout

    // Verificar uso de recursos
    console.log("\nUso de recursos del servidor:")
    const resourcesResult = await executeCommandSSH(ssh, "free -h && df -h")
    console.log(resourcesResult.stdout)
    monitorInfo.resources = resourcesResult.stdout

    console.log("\nMonitoreo completado")
    return monitorInfo
  } catch (error) {
    console.error("Error durante el monitoreo:", error)
    throw error
  } finally {
    // Cerrar la conexión SSH
    if (ssh) {
      await disconnectSSH(ssh)
    }
  }
}

/**
 * Reinicia el bot en el servidor
 * @returns {Promise<boolean>} - true si el reinicio fue exitoso
 */
async function restartBot() {
  let ssh = null

  try {
    console.log(`Conectando al servidor para reiniciar ${BOT_NAME}...`)

    // Conectar al servidor SSH
    ssh = await connectSSH()

    // Reiniciar el bot con PM2
    console.log(`Reiniciando ${BOT_NAME}...`)
    const result = await executeCommandSSH(ssh, `pm2 restart ${BOT_NAME}`)

    if (result.stderr) {
      console.error(`Error al reiniciar ${BOT_NAME}:`, result.stderr)
      return false
    } else {
      console.log(`${BOT_NAME} reiniciado exitosamente`)

      // Verificar estado después del reinicio
      const statusResult = await executeCommandSSH(ssh, "pm2 status")
      console.log("Estado actual de PM2:")
      console.log(statusResult.stdout)
      return true
    }
  } catch (error) {
    console.error("Error durante el reinicio:", error)
    return false
  } finally {
    // Cerrar la conexión SSH
    if (ssh) {
      await disconnectSSH(ssh)
    }
  }
}

// Exportar todas las funciones
module.exports = {
  connectSSH,
  executeCommandSSH,
  disconnectSSH,
  deployBot,
  setupPM2,
  monitorBot,
  restartBot,
}