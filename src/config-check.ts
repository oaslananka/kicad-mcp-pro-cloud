import { loadConfig } from "./config.js";
// No values, URLs, token names or credential material are printed.
loadConfig();
process.stdout.write("Runtime configuration contract verified.\n");
