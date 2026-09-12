import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PathBoundaryError, resolveWithin } from "../security/path-boundary";
import { AcquisitionLimitError, DEFAULT_ACQUISITION_LIMITS, throwIfAcquisitionAborted, type AcquisitionLimits } from "./extraction-acquisition";
import { assertInertSourceMarkup, assertSafeBundleRelativePath } from "./extraction-safety";
import { inspectCanonicalTree, validateCanonicalTree, type CanonicalTreeManifest } from "./canonical-tree-manifest";
import { CANONICAL_EXTRACTION_FILES, readValidatedExtractionSidecar, type ValidatedExtractionSidecar } from "./extraction-sidecar";

export class ExtractionPublicationError extends Error {
  readonly name = "ExtractionPublicationError";

  constructor(
    readonly code: "system_id_conflict" | "invalid_bundle" | "publication_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export type ExtractionReservation = {
  readonly id: string;
  readonly root: string;
  readonly stagingDir: string;
  readonly destinationDir: string;
  readonly reservationDir: string;
  readonly publicationToken: string;
};

export async function reserveExtractionBundle(root: string, id: string): Promise<ExtractionReservation> {
  await mkdir(root, { recursive: true });
  const reservationRoot = resolveWithin(root, ".extraction-reservations");
  await mkdir(reservationRoot, { recursive: true });
  const reservationDir = resolveWithin(reservationRoot, assertSafeBundleRelativePath(id));
  try {
    await mkdir(reservationDir);
  } catch (error) {
    if (isFileSystemError(error, "EEXIST")) {
      throw new ExtractionPublicationError("system_id_conflict", "Design system ID is already reserved");
    }
    throw error;
  }
  const destinationDir = resolveWithin(root, id);
  if (await pathExists(destinationDir)) {
    await rm(reservationDir, { recursive: true });
    throw new ExtractionPublicationError("system_id_conflict", "Design system destination already exists");
  }
  const publicationToken = randomUUID();
  const stagingDir = resolveWithin(root, `.${id}.staging-${publicationToken}`);
  await mkdir(stagingDir);
  await writeFile(path.join(stagingDir, ".burnguard-publication"), publicationToken, "utf8");
  return { id, root, stagingDir, destinationDir, reservationDir, publicationToken };
}

export async function validateExtractionBundle(
  reservation: ExtractionReservation,
  signal?: AbortSignal,
  limits: AcquisitionLimits = DEFAULT_ACQUISITION_LIMITS,
): Promise<ValidatedExtractionSidecar & { readonly manifest: CanonicalTreeManifest }> {
  let units = 0;
  let bytes = 0;
  for (const relativePath of CANONICAL_EXTRACTION_FILES) {
    throwIfAcquisitionAborted(signal);
    units += 1;
    const target = resolveWithin(reservation.stagingDir, ...relativePath.split("/"));
    const info = await stat(target).catch(() => null);
    if (!info?.isFile()) {
      throw new ExtractionPublicationError("invalid_bundle", `Missing canonical extraction file: ${relativePath}`);
    }
  }
  let files: readonly string[];
  try {
    files = await listBundleFiles(reservation.stagingDir, limits);
  } catch (error) {
    if (error instanceof PathBoundaryError) {
      throw new ExtractionPublicationError("invalid_bundle", "Extraction bundle escapes its staging boundary");
    }
    throw error;
  }
  for (const file of files) {
    throwIfAcquisitionAborted(signal);
    units += 1;
    if (units > limits.publicationUnits) throw new AcquisitionLimitError("publication_units", limits.publicationUnits, units);
    const relativePath = assertSafeBundleRelativePath(path.relative(reservation.stagingDir, file));
    bytes += (await stat(file)).size;
    if (bytes > limits.publicationBytes) {
      throw new AcquisitionLimitError("publication_bytes", limits.publicationBytes, bytes);
    }
    const extension = path.extname(relativePath).toLowerCase();
    if (extension === ".html" || extension === ".svg") {
      const markup = await readFile(file, "utf8");
      // Canonical previews may load only this bundle-local token sheet. Keep
      // source/UI-kit validation strict and validate every other byte unchanged.
      const inertMarkup = /^preview\/[^/]+\.html$/.test(relativePath)
        ? markup.replace('<link rel="stylesheet" href="../colors_and_type.css">', "")
        : markup;
      assertInertSourceMarkup(inertMarkup, extension === ".svg" ? "svg" : "html");
    }
  }
  try {
    const [sidecar, manifest] = await Promise.all([
      readValidatedExtractionSidecar(reservation.stagingDir),
      inspectCanonicalTree(reservation.stagingDir, { files: limits.publicationUnits, bytes: limits.publicationBytes }),
    ]);
    return { ...sidecar, manifest };
  } catch (error) {
    if (error instanceof Error) throw new ExtractionPublicationError("invalid_bundle", error.message, { cause: error });
    throw error;
  }
}

export async function publishExtractionBundle(
  reservation: ExtractionReservation,
  signal?: AbortSignal,
  expectedManifest?: CanonicalTreeManifest,
): Promise<void> {
  throwIfAcquisitionAborted(signal);
  const manifest = expectedManifest ?? await inspectCanonicalTree(reservation.stagingDir);
  if (await pathExists(reservation.destinationDir)) {
    throw new ExtractionPublicationError("system_id_conflict", "Design system destination already exists");
  }
  try {
    await rename(reservation.stagingDir, reservation.destinationDir);
    await validateCanonicalTree(reservation.destinationDir, manifest);
  } catch (error) {
    throw new ExtractionPublicationError("publication_failed", "Could not atomically publish a verified extraction bundle", { cause: error });
  }
}

export async function rollbackExtractionPublication(reservation: ExtractionReservation): Promise<void> {
  const marker = await readFile(path.join(reservation.destinationDir, ".burnguard-publication"), "utf8").catch(() => null);
  await Promise.all([
    rm(reservation.stagingDir, { recursive: true, force: true }),
    marker === reservation.publicationToken
      ? rm(reservation.destinationDir, { recursive: true, force: true })
      : Promise.resolve(),
    rm(reservation.reservationDir, { recursive: true, force: true }),
  ]);
}

export async function completeExtractionPublication(reservation: ExtractionReservation): Promise<void> {
  await Promise.all([
    rm(path.join(reservation.destinationDir, ".burnguard-publication"), { force: true }),
    rm(reservation.reservationDir, { recursive: true, force: true }),
  ]);
}

export async function reconcileExtractionPublications(root: string): Promise<{ readonly removed_staging: number; readonly removed_reservations: number }> {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const staging = entries.filter((entry) => entry.isDirectory() && /^\..+\.staging-[0-9a-f-]+$/i.test(entry.name));
  await Promise.all(staging.map((entry) => rm(resolveWithin(root, entry.name), { recursive: true, force: true })));
  const reservationRoot = resolveWithin(root, ".extraction-reservations");
  const reservations = await readdir(reservationRoot, { withFileTypes: true }).catch((error) => {
    if (isFileSystemError(error, "ENOENT")) return [];
    throw error;
  });
  await Promise.all(reservations.map((entry) => rm(resolveWithin(reservationRoot, entry.name), { recursive: true, force: true })));
  return { removed_staging: staging.length, removed_reservations: reservations.length };
}

async function listBundleFiles(root: string, limits: AcquisitionLimits): Promise<readonly string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = resolveWithin(root, path.relative(root, directory), entry.name);
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new ExtractionPublicationError("invalid_bundle", "Extraction bundle cannot contain links");
      if (info.isDirectory()) await visit(target);
      else if (info.isFile()) {
        if (files.length >= limits.publicationUnits) throw new AcquisitionLimitError("publication_units", limits.publicationUnits, files.length + 1);
        files.push(target);
      }
    }
  };
  await visit(root);
  return files.sort();
}

function isFileSystemError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function pathExists(target: string): Promise<boolean> {
  return (await stat(target).catch(() => null)) !== null;
}
