import { log, LogModule } from './logger';

export interface LiteParseResult {
  text: string;
  pageCount: number;
  ocrUsed: boolean;
  ocrPages: number[];
}

interface PageInfo {
  pageNum: number;
  textLen: number;
  hasLargeImage: boolean;
}

const OCR_TEXT_THRESHOLD = 100;
const DEFAULT_IMAGE_THRESHOLD = 0.5;

let LiteParseClass: (new (config: Record<string, unknown>) => LiteParseInstance) | null = null;
let fastParser: LiteParseInstance | null = null;
let ocrParser: LiteParseInstance | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LiteParseInstance = any;

async function ensureParsers(): Promise<void> {
  if (LiteParseClass) return;

  // LiteParse is ESM-only — require() fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
  // Use dynamic import() hidden from webpack so it doesn't get transformed to require().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>;
  const mod = await dynamicImport('@llamaindex/liteparse');
  LiteParseClass = mod.LiteParse ?? mod.default?.LiteParse ?? mod.default;
  if (!LiteParseClass || typeof LiteParseClass !== 'function') {
    throw new Error(`Failed to load LiteParse: got ${typeof LiteParseClass} from module keys [${Object.keys(mod).join(', ')}]`);
  }

  fastParser = new LiteParseClass!({
    ocrEnabled: false,
    outputFormat: 'text',
    preciseBoundingBox: false,
  });

  ocrParser = new LiteParseClass!({
    ocrEnabled: true,
    ocrLanguage: ['vie', 'eng'],
    outputFormat: 'text',
    preciseBoundingBox: false,
  });
}

function detectOcrPages(
  parser: LiteParseInstance,
  imageThreshold: number,
): { capturedPages: PageInfo[]; originalExtractPage: unknown } {
  const capturedPages: PageInfo[] = [];
  const originalExtractPage = parser.pdfEngine.extractPage.bind(parser.pdfEngine);

  parser.pdfEngine.extractPage = async (...args: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (originalExtractPage as (...a: unknown[]) => Promise<any>)(...args);
    const textLen = result.textItems.reduce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sum: number, item: any) => sum + item.str.length, 0,
    );
    const pageArea = result.width * result.height;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasLargeImage = (result.images || []).some((img: any) =>
      (img.width * img.height) / pageArea >= imageThreshold,
    );
    capturedPages.push({ pageNum: result.pageNum, textLen, hasLargeImage });
    return result;
  };

  return { capturedPages, originalExtractPage };
}

export async function extractPdfWithLiteParse(
  filePath: string,
  options?: { imageThreshold?: number; targetPages?: string },
): Promise<LiteParseResult> {
  await ensureParsers();

  const imageThreshold = options?.imageThreshold ?? DEFAULT_IMAGE_THRESHOLD;

  // Pass 1: fast extraction without OCR
  const { capturedPages, originalExtractPage } = detectOcrPages(fastParser!, imageThreshold);

  let parseConfig: Record<string, unknown> | undefined;
  if (options?.targetPages) {
    parseConfig = { targetPages: options.targetPages };
  }

  const fastResult = parseConfig
    ? await new LiteParseClass!({ ...fastParser!.config, ...parseConfig }).parse(filePath)
    : await fastParser!.parse(filePath);

  // Restore original extractPage
  fastParser!.pdfEngine.extractPage = originalExtractPage;

  // Determine which pages need OCR
  const ocrPageNums = capturedPages
    .filter(p => p.textLen < OCR_TEXT_THRESHOLD || p.hasLargeImage)
    .map(p => p.pageNum);

  if (ocrPageNums.length === 0) {
    return {
      text: fastResult.text,
      pageCount: fastResult.pages.length,
      ocrUsed: false,
      ocrPages: [],
    };
  }

  // Pass 2: re-parse with OCR
  log.info(LogModule.Filter, `OCR needed for ${ocrPageNums.length}/${capturedPages.length} pages in ${filePath}`);

  const ocrResult = parseConfig
    ? await new LiteParseClass!({ ...ocrParser!.config, ...parseConfig }).parse(filePath)
    : await ocrParser!.parse(filePath);

  return {
    text: ocrResult.text,
    pageCount: ocrResult.pages.length,
    ocrUsed: true,
    ocrPages: ocrPageNums,
  };
}

export async function extractPdfTextLite(
  fullPath: string,
  targetPages?: string,
): Promise<string> {
  const result = await extractPdfWithLiteParse(fullPath, {
    targetPages: targetPages ?? '1-2',
  });
  return result.text;
}
