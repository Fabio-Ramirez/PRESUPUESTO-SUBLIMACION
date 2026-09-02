import { crearApp } from './app.js';
import { config } from './config.js';
import { conectar, desconectar } from './db.js';
import { cerrarNavegador } from './pdf/generador.js';

async function arrancar(): Promise<void> {
  await conectar();
  const servidor = crearApp().listen(config.puerto, () => {
    console.log(`API escuchando en http://localhost:${config.puerto}/api`);
  });

  // Cierre ordenado: sin esto, un reinicio deja conexiones colgadas contra Mongo.
  for (const senial of ['SIGINT', 'SIGTERM'] as const) {
    process.on(senial, () => {
      servidor.close(() => {
        void Promise.all([desconectar(), cerrarNavegador()]).then(() => process.exit(0));
      });
    });
  }
}

arrancar().catch((e: unknown) => {
  if (esRechazoDeConexionMongo(e)) {
    console.error(
      '\nNo se pudo conectar a MongoDB en ' +
        `${config.mongoUri}\n\n` +
        'El motivo mas comun es que el servicio de MongoDB no esta iniciado.\n' +
        'Para revisarlo, abri PowerShell y corre:\n\n' +
        '    Get-Service | Where-Object { $_.Name -like "*Mongo*" }\n\n' +
        'Si aparece con Status "Stopped", iniciala con:\n\n' +
        '    Start-Service <el nombre que aparecio>\n\n' +
        'Si no aparece ningun servicio, MongoDB no quedo instalado como servicio ' +
        '(o no se instalo). Volve a correr el instalador de MongoDB Community Server ' +
        'y tilda "Install MongoDB as a Service".\n',
    );
  } else {
    console.error('No se pudo arrancar la API:', e);
  }
  process.exit(1);
});

/**
 * Distingue "Mongo no esta arriba" del resto de los errores posibles al arrancar,
 * para poder explicar el arreglo en vez de tirar el stack crudo de Mongoose. Es
 * exactamente el error que se ve la primera vez que se instala en una maquina
 * nueva y el servicio de MongoDB todavia no quedo levantado.
 */
function esRechazoDeConexionMongo(e: unknown): boolean {
  return (
    e instanceof Error &&
    e.name === 'MongooseServerSelectionError' &&
    e.message.includes('ECONNREFUSED')
  );
}
