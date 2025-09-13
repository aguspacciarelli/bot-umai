// api_handler.js
const fetch = require('node-fetch');

const API_ENDPOINT = 'https://apiaulas.umai-multimedia.duckdns.org/api/reservations';

async function getReservations() {
  try {
    const response = await fetch(API_ENDPOINT);

    if (!response.ok) {
      console.error(`Error al fetchear la API (status ${response.status}): ${response.statusText}`);
      return null; // O lanza un error personalizado
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error al fetchear la API:', error);
    return null; // O lanza un error personalizado
  }
}

module.exports = { getReservations };