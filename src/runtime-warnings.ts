/** Install before loading node:sqlite. Keep all other Node and application warnings. */
const sqliteWarning =
  "SQLite is an experimental feature and might change at any time";
if (process.env.OPENFUN_SHOW_RUNTIME_WARNINGS !== "1") {
  const emitWarning = process.emitWarning;
  process.emitWarning = function (
    warning: string | Error,
    typeOrOptions?: string | { type?: string },
    ...rest: unknown[]
  ) {
    const message = typeof warning === "string" ? warning : warning.message;
    const type =
      typeof warning === "string"
        ? typeof typeOrOptions === "string"
          ? typeOrOptions
          : typeOrOptions?.type
        : warning.name;
    if (message === sqliteWarning && type === "ExperimentalWarning") return;
    Reflect.apply(emitWarning, process, [warning, typeOrOptions, ...rest]);
  } as typeof process.emitWarning;
}
