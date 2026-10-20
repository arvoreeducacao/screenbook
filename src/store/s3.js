export function parseS3Spec(spec) {
  const match = spec.match(/^([\w.-]+)(?:\/(.*))?$/);
  if (!match) throw new Error(`invalid s3 store: ${spec} (expected bucket[/prefix])`);
  return { bucket: match[1], prefix: (match[2] ?? "").replace(/\/+$/, "") };
}

export async function s3Store(spec, { client } = {}) {
  const { bucket, prefix } = parseS3Spec(spec);
  const sdk = await import("@aws-sdk/client-s3");
  const s3 = client ?? new sdk.S3Client({});

  function key(path) {
    return [prefix, path].filter(Boolean).join("/");
  }

  async function read(path) {
    try {
      const result = await s3.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: key(path) }));
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  }

  async function write(path, data) {
    await s3.send(new sdk.PutObjectCommand({ Bucket: bucket, Key: key(path), Body: Buffer.from(data) }));
  }

  return {
    kind: "s3",
    describe: () => `s3://${bucket}${prefix ? `/${prefix}` : ""}`,
    read,
    write,

    async append(path, text) {
      const current = (await read(path))?.toString("utf8") ?? "";
      await write(path, current + text);
    },

    async list(start) {
      const found = [];
      let token;
      const strip = prefix ? prefix.length + 1 : 0;
      do {
        const page = await s3.send(
          new sdk.ListObjectsV2Command({ Bucket: bucket, Prefix: key(start), ContinuationToken: token }),
        );
        for (const item of page.Contents ?? []) found.push(item.Key.slice(strip));
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return found.sort();
    },
  };
}
