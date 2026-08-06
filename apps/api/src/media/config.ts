import type { MediaConfigUpdate, MediaProvider, MediaStatus } from "@cms/shared";
import { prisma } from "../db.js";

const KEYS = {
  provider: "media.provider",
  publicKey: "media.imagekit.publicKey",
  privateKey: "media.imagekit.privateKey",
  urlEndpoint: "media.imagekit.urlEndpoint",
  folder: "media.imagekit.folder",
} as const;

export type ResolvedMediaConfig = {
  provider: MediaProvider;
  publicKey: string | null;
  privateKey: string | null;
  urlEndpoint: string | null;
  folder: string | null;
  imagekitConfigured: boolean;
  source: "settings" | "none";
};

function maskKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
}

async function getSetting(
  websiteId: string,
  key: string,
): Promise<string | null> {
  const row = await prisma.setting.findUnique({
    where: { websiteId_key: { websiteId, key } },
  });
  const value = row?.value?.trim();
  return value ? value : null;
}

async function upsertSetting(websiteId: string, key: string, value: string) {
  await prisma.setting.upsert({
    where: { websiteId_key: { websiteId, key } },
    create: { websiteId, key, value },
    update: { value },
  });
}

async function deleteSetting(websiteId: string, key: string) {
  await prisma.setting.deleteMany({ where: { websiteId, key } });
}

function parseProvider(raw: string | null): MediaProvider {
  return raw === "imagekit" ? "imagekit" : "local";
}

/** Resolve media storage config for one website. */
export async function resolveMediaConfig(
  websiteId: string,
): Promise<ResolvedMediaConfig> {
  const [providerRaw, publicKey, privateKey, urlEndpoint, folder] =
    await Promise.all([
      getSetting(websiteId, KEYS.provider),
      getSetting(websiteId, KEYS.publicKey),
      getSetting(websiteId, KEYS.privateKey),
      getSetting(websiteId, KEYS.urlEndpoint),
      getSetting(websiteId, KEYS.folder),
    ]);

  const imagekitConfigured = Boolean(publicKey && privateKey && urlEndpoint);
  const hasAny = Boolean(
    providerRaw || publicKey || privateKey || urlEndpoint || folder,
  );

  return {
    provider: parseProvider(providerRaw),
    publicKey,
    privateKey,
    urlEndpoint,
    folder,
    imagekitConfigured,
    source: hasAny ? "settings" : "none",
  };
}

export async function updateMediaConfig(
  websiteId: string,
  input: MediaConfigUpdate,
) {
  if (input.provider !== undefined) {
    await upsertSetting(websiteId, KEYS.provider, input.provider);
  }

  if (input.clearPublicKey) {
    await deleteSetting(websiteId, KEYS.publicKey);
  } else if (input.publicKey !== undefined) {
    const value = input.publicKey.trim();
    if (!value) await deleteSetting(websiteId, KEYS.publicKey);
    else await upsertSetting(websiteId, KEYS.publicKey, value);
  }

  if (input.clearPrivateKey) {
    await deleteSetting(websiteId, KEYS.privateKey);
  } else if (input.privateKey !== undefined) {
    const value = input.privateKey.trim();
    if (!value) await deleteSetting(websiteId, KEYS.privateKey);
    else await upsertSetting(websiteId, KEYS.privateKey, value);
  }

  if (input.urlEndpoint !== undefined) {
    const value = input.urlEndpoint.trim().replace(/\/$/, "");
    if (!value) await deleteSetting(websiteId, KEYS.urlEndpoint);
    else await upsertSetting(websiteId, KEYS.urlEndpoint, value);
  }

  if (input.folder !== undefined) {
    if (input.folder === null) {
      await deleteSetting(websiteId, KEYS.folder);
    } else {
      const value = input.folder.trim();
      if (!value) await deleteSetting(websiteId, KEYS.folder);
      else await upsertSetting(websiteId, KEYS.folder, value);
    }
  }

  return toPublicMediaStatus(websiteId);
}

export async function toPublicMediaStatus(
  websiteId: string,
): Promise<MediaStatus> {
  const config = await resolveMediaConfig(websiteId);
  const configured =
    config.provider === "local" ||
    (config.provider === "imagekit" && config.imagekitConfigured);

  return {
    provider: config.provider,
    configured,
    imagekitConfigured: config.imagekitConfigured,
    publicKey: config.publicKey,
    publicKeyConfigured: Boolean(config.publicKey),
    publicKeyPreview: maskKey(config.publicKey),
    privateKeyConfigured: Boolean(config.privateKey),
    privateKeyPreview: maskKey(config.privateKey),
    urlEndpoint: config.urlEndpoint,
    folder: config.folder,
    source: config.source,
  };
}
