export class ExportError extends Error {
  readonly name = "ExportError";

  constructor(readonly code: "not_implemented") {
    super(code);
  }
}
