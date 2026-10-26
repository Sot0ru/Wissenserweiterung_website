// Baut public/data/index.json aus den Einzeldateien in public/data/artikel/ neu.
// Nützlich, wenn ein Lauf abgebrochen ist oder Artikel von Hand geändert wurden: npm run index
import { rebuildIndex } from "./store.mjs";

const index = await rebuildIndex();
console.log(`Index neu gebaut: ${index.count} Artikel.`);
