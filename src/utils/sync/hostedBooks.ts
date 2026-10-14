import { getSupabase } from "./supabaseClient";
import BookUtil from "../file/bookUtil";
import { importBookFromUrl } from "./devImport";

// ReadParty Phase 2: "upload once, share link only".
// A book is stored in Supabase Storage keyed by its content MD5, with a row in
// `hosted_books` mapping md5 -> storage path + metadata. The invite link only
// carries the md5; the partner's client fetches + imports the file on join.

const BUCKET = "books";
// Guard against filling the free-tier Storage quota with oversized/garbage
// uploads. EPUBs are typically a few MB; 60MB is a generous ceiling.
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

export type HostedBookRow = {
  md5: string;
  title: string | null;
  format: string | null;
  size: number | null;
  storage_path: string;
};

const storagePathFor = (md5: string, format: string): string =>
  `${md5}.${format.toLowerCase()}`;

export const getHostedBook = async (
  md5: string
): Promise<HostedBookRow | null> => {
  if (!md5) return null;
  try {
    const supabase = getSupabase();
    // Preferred: single-row lookup via a SECURITY DEFINER RPC so the anon key
    // cannot enumerate the whole library (no broad SELECT on hosted_books).
    const { data, error } = await supabase.rpc("get_hosted_book", {
      p_md5: md5,
    });
    if (!error) {
      const row = Array.isArray(data) ? data[0] : data;
      return (row as HostedBookRow) || null;
    }
    // Fallback for environments where the RPC hasn't been deployed yet: a
    // direct filtered read (works only while the table still allows SELECT).
    const { data: rows } = await supabase
      .from("hosted_books")
      .select("*")
      .eq("md5", md5)
      .maybeSingle();
    return (rows as HostedBookRow) || null;
  } catch (e) {
    return null;
  }
};

// Upload a local book to hosted storage (idempotent by md5). Returns true if
// the book is hosted after the call (already-present counts as success).
export const uploadHostedBook = async (book: any): Promise<boolean> => {
  try {
    if (!book || !book.md5) return false;
    const md5: string = book.md5;
    const format: string = (book.format || "epub").toLowerCase();

    const existing = await getHostedBook(md5);
    if (existing) return true;

    const buffer = await BookUtil.fetchBook(
      book.key,
      format,
      true,
      book.path
    );
    if (!buffer || buffer === true) return false;
    if ((buffer as ArrayBuffer).byteLength > MAX_UPLOAD_BYTES) return false;

    const supabase = getSupabase();
    const path = storagePathFor(md5, format);
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer as ArrayBuffer, {
        contentType: "application/octet-stream",
        upsert: true,
      });
    // A concurrent uploader may have won the race; treat "already exists" as ok.
    if (uploadError && !/exists/i.test(uploadError.message || "")) {
      return false;
    }

    const { error: rowError } = await supabase.from("hosted_books").upsert({
      md5,
      title: book.name || null,
      format,
      size: book.size || null,
      storage_path: path,
    });
    if (rowError) return false;

    return true;
  } catch (e) {
    return false;
  }
};

// Download a hosted book by md5 and import it into the local library, reusing
// Koodo's own import pipeline. Returns the imported book identity or null.
export const importHostedBook = async (
  md5: string
): Promise<{ key: string; md5: string; name: string } | null> => {
  const row = await getHostedBook(md5);
  if (!row) return null;

  const supabase = getSupabase();
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(row.storage_path);
  const url = data && data.publicUrl;
  if (!url) return null;

  const safeTitle = (row.title || "book").replace(/[/\\?%*:|"<>]/g, "-");
  const fileName = `${safeTitle}.${(row.format || "epub").toLowerCase()}`;
  const result = await importBookFromUrl(url, fileName);
  return { key: result.key, md5: result.md5, name: result.name };
};
