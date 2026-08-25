import { PrismaClient } from "@prisma/client";

/**
 * Instance unique de PrismaClient partagée dans toute l'app — évite
 * d'ouvrir une nouvelle connexion à la base à chaque import (problème
 * classique en dev avec le hot-reload).
 */
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
