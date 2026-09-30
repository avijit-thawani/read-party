import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import * as Kookit from "../../assets/lib/kookit.min";
import { BookHelper } from "../../assets/lib/kookit.min";
import BookUtil from "../file/bookUtil";
import DatabaseService from "../storage/databaseService";
import CoverUtil from "../file/coverUtil";
import { calculateFileMD5, getTextRules } from "../common";

// Dev/E2E-only helper: import a book into the local library from a served URL,
// reusing Koodo's own pipeline (BookHelper + BookUtil + DatabaseService).
// This lets automated tests seed a book without driving a native file picker.
export async function importBookFromUrl(
  url: string,
  displayName?: string
): Promise<{ key: string; md5: string; name: string; reused?: boolean }> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error("Failed to fetch book: " + resp.status);
  }
  const blob = await resp.blob();
  const nameFromUrl = decodeURIComponent(
    (url.split("/").pop() || "book.epub").split("?")[0]
  );
  const fileName = displayName || nameFromUrl;
  const file = new File([blob], fileName, { type: blob.type });

  const md5 = await calculateFileMD5(file);
  const existing: any = await BookUtil.getBookByMd5(md5);
  if (existing) {
    return { key: existing.key, md5, name: existing.name, reused: true };
  }

  const arrayBuffer = await file.arrayBuffer();
  const extension = (fileName.split(".").pop() || "epub").toLowerCase();
  const bookName = fileName.substring(
    0,
    fileName.length - extension.length - 1
  );

  const rendition = BookHelper.getRendition(
    arrayBuffer,
    {
      format: extension.toUpperCase(),
      readerMode: "",
      charset: "",
      animation: ConfigService.getReaderConfig("animation") || "none",
      convertChinese: ConfigService.getReaderConfig("convertChinese"),
      bookLayout: ConfigService.getReaderConfig("bookLayout"),
      textRules: getTextRules(),
      codeHighlight: ConfigService.getReaderConfig("codeHighlight") || "",
      fullTranslationMode: "no",
      textOrientation: ConfigService.getReaderConfig("textOrientation"),
      parserRegex: "",
      isDarkMode: "no",
      isMobile: "no",
      password: "",
      isScannedPDF: "no",
      isKeepPDFBackground: "no",
    } as any,
    Kookit
  );

  const book: any = await BookHelper.generateBook(
    bookName,
    extension,
    md5,
    (file as any).size,
    "",
    arrayBuffer,
    rendition
  );

  await BookUtil.addBook(book.key, book.format.toLowerCase(), arrayBuffer);
  try {
    await CoverUtil.addCover(book);
  } catch (e) {
    /* cover is non-essential */
  }
  await DatabaseService.saveRecord(book, "books");

  return { key: book.key, md5, name: book.name };
}
