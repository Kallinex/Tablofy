import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

export const EXPORT_EXTENSIONS: Record<string, string> = {
  CSV: 'csv',
  EXCEL: 'xlsx',
  PDF: 'pdf',
};

export const EXPORT_MIME_TYPES: Record<string, string> = {
  CSV: 'text/csv; charset=utf-8',
  EXCEL: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  PDF: 'application/pdf',
};

export interface WriteExportResult {
  relativePath: string;
  absolutePath: string;
  fileSize: number;
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]+$/;

@Injectable()
export class ExportStorageService implements OnModuleInit {
  private readonly logger = new Logger(ExportStorageService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    fs.mkdirSync(this.getExportRoot(), { recursive: true });
    this.logger.log('Export storage root ready');
  }

  getExportRoot(): string {
    return this.configService.get<string>('EXPORT_DIR', path.join(process.cwd(), 'exports'));
  }

  async writeExport(
    tenantId: string,
    exportId: string,
    ext: string,
    buffer: Buffer,
  ): Promise<WriteExportResult> {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('Cannot write an empty export file');
    }
    this.assertIdentifier(tenantId, 'tenantId');
    this.assertIdentifier(exportId, 'exportId');

    const root = this.getExportRoot();
    const tenantDir = path.join(root, tenantId);
    const finalPath = path.join(tenantDir, `${exportId}.${ext}`);
    this.assertContained(root, finalPath);

    await fs.promises.mkdir(tenantDir, { recursive: true });
    await this.cleanStaleTempFiles(tenantDir, `${exportId}.${ext}`);

    const tmpPath = path.join(
      tenantDir,
      `${exportId}.${ext}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`,
    );

    try {
      await fs.promises.writeFile(tmpPath, buffer, { flag: 'wx' });
      await fs.promises.rename(tmpPath, finalPath);
      const stat = await fs.promises.stat(finalPath);
      if (!stat.isFile() || stat.size === 0 || stat.size !== buffer.length) {
        throw new Error('Export file write verification failed');
      }
      return {
        relativePath: `${tenantId}/${exportId}.${ext}`,
        absolutePath: finalPath,
        fileSize: stat.size,
      };
    } catch (error) {
      await this.safeUnlink(tmpPath);
      throw error;
    }
  }

  async readExport(tenantId: string, relativePath: string): Promise<Buffer> {
    this.assertSafeRelativePath(tenantId, relativePath);

    const root = this.getExportRoot();
    const absolute = path.resolve(root, relativePath);
    this.assertContained(root, absolute);

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(absolute);
    } catch {
      throw new NotFoundException('Export file not found');
    }
    if (!stat.isFile() || stat.size === 0) {
      throw new NotFoundException('Export file not found');
    }
    return fs.promises.readFile(absolute);
  }

  async deleteExport(tenantId: string, relativePath: string): Promise<void> {
    this.assertSafeRelativePath(tenantId, relativePath);

    const root = this.getExportRoot();
    const absolute = path.resolve(root, relativePath);
    this.assertContained(root, absolute);

    try {
      await fs.promises.unlink(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private assertIdentifier(value: string, field: string): void {
    if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
      throw new BadRequestException(`Invalid ${field}`);
    }
  }

  private assertSafeRelativePath(tenantId: string, relativePath: string): void {
    if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
      throw new BadRequestException('Export file path is invalid');
    }
    const segments = relativePath.split(/[\\/]+/);
    if (segments.some((segment) => segment === '' || segment === '..' || segment === '.')) {
      throw new BadRequestException('Export file path is invalid');
    }
    if (!relativePath.startsWith(`${tenantId}/`) && !relativePath.startsWith(`${tenantId}\\`)) {
      throw new NotFoundException('Export file not found');
    }
  }

  private assertContained(root: string, candidate: string): void {
    const normalizedRoot = path.resolve(root);
    const normalizedCandidate = path.resolve(candidate);
    if (
      normalizedCandidate !== normalizedRoot &&
      !normalizedCandidate.startsWith(normalizedRoot + path.sep)
    ) {
      throw new BadRequestException('Export file path is invalid');
    }
  }

  private async cleanStaleTempFiles(tenantDir: string, base: string): Promise<void> {
    try {
      const entries = await fs.promises.readdir(tenantDir);
      const stale = entries.filter((name) => name.startsWith(`${base}.tmp-`));
      await Promise.all(stale.map((name) => this.safeUnlink(path.join(tenantDir, name))));
    } catch {
      // best-effort cleanup; never fail the export write because of stale temp files
    }
  }

  private async safeUnlink(filePath: string): Promise<void> {
    try {
      await fs.promises.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`Failed to remove temp file ${filePath}`);
      }
    }
  }
}
