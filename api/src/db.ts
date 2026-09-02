import mongoose from 'mongoose';
import { config } from './config.js';

/**
 * `strictQuery` en true: un filtro con un campo que no existe en el esquema tira
 * error en vez de devolver la coleccion entera en silencio.
 */
mongoose.set('strictQuery', true);

export async function conectar(): Promise<void> {
  await mongoose.connect(config.mongoUri);
  // Crea los indices declarados en los esquemas. Los unique y el parcial de
  // `numero` son reglas de negocio, no optimizaciones: sin ellos la base acepta
  // dos presupuestos con el mismo numero.
  await mongoose.syncIndexes();
}

export async function desconectar(): Promise<void> {
  await mongoose.disconnect();
}
