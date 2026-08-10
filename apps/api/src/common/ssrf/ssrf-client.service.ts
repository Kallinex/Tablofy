import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import http from 'node:http';
import https from 'node:https';
import { isIP, LookupFunction } from 'node:net';
import {
  assertSafeOutboundUrl,
  DnsResolver,
  SafeUrl,
  SsrfBlockedError,
  SsrfUrlOptions,
} from './ssrf-guard';

export interface SsrfPostOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRedirects?: number;
  validateStatus?: (status: number) => boolean;
  allowedProtocols?: readonly string[];
}

/**
 * HTTP client for tenant/user-controlled outbound requests.
 *
 * - Validates the target URL (protocol, hostname, credentials).
 * - Resolves the hostname and requires every address to be public.
 * - Pins the resolved public addresses in the underlying socket lookup so a
 *   DNS rebinding between validation and connect cannot introduce a private
 *   address.
 * - Follows redirects manually, re-validating every redirect target before it
 *   is requested.
 *
 * Blocked targets raise SsrfBlockedError and never reach the HTTP client.
 */
@Injectable()
export class SsrfClientService {
  private readonly logger = new Logger(SsrfClientService.name);
  private readonly defaultMaxRedirects = 5;
  private resolver?: DnsResolver;

  /** Overrides DNS resolution (used by tests); undefined keeps the OS resolver. */
  setResolver(resolver: DnsResolver | undefined): this {
    this.resolver = resolver;
    return this;
  }

  async assertUrlSafe(rawUrl: string, options?: SsrfUrlOptions): Promise<SafeUrl> {
    return assertSafeOutboundUrl(rawUrl, options, this.resolver);
  }

  async postJson<T = unknown>(
    url: string,
    data: unknown,
    options: SsrfPostOptions = {},
  ): Promise<AxiosResponse<T>> {
    const safeUrl = await assertSafeOutboundUrl(
      url,
      { allowedProtocols: options.allowedProtocols },
      this.resolver,
    );

    const config: AxiosRequestConfig = {
      method: 'post',
      url: safeUrl.url.href,
      data,
      headers: options.headers,
      timeout: options.timeoutMs,
      validateStatus: options.validateStatus,
      maxRedirects: 0,
    };

    return this.requestWithRedirects<T>(
      config,
      options.allowedProtocols,
      options.maxRedirects ?? this.defaultMaxRedirects,
    );
  }

  private async requestWithRedirects<T>(
    config: AxiosRequestConfig,
    allowedProtocols: readonly string[] | undefined,
    maxRedirects: number,
    redirectCount = 0,
  ): Promise<AxiosResponse<T>> {
    if (redirectCount > maxRedirects) {
      throw new SsrfBlockedError('Redirect limit exceeded');
    }

    const safeUrl = await assertSafeOutboundUrl(
      config.url ?? '',
      { allowedProtocols },
      this.resolver,
    );

    const response = await axios.request<T>({
      ...config,
      url: safeUrl.url.href,
      httpAgent: this.agentFor(safeUrl, 'http'),
      httpsAgent: this.agentFor(safeUrl, 'https'),
    });

    const status = response.status;
    const location = response.headers?.location;

    if (status >= 300 && status < 400 && location) {
      let nextHref: string;
      try {
        nextHref = new URL(location, safeUrl.url.href).href;
      } catch {
        throw new SsrfBlockedError('Redirect location is not a valid URL');
      }

      const nextSafeUrl = await assertSafeOutboundUrl(
        nextHref,
        { allowedProtocols },
        this.resolver,
      );

      return this.requestWithRedirects<T>(
        {
          ...config,
          url: nextSafeUrl.url.href,
        },
        allowedProtocols,
        maxRedirects,
        redirectCount + 1,
      );
    }

    return response;
  }

  private agentFor(safeUrl: SafeUrl, protocol: 'http' | 'https'): http.Agent | https.Agent {
    const pinned = [...safeUrl.addresses];

    const lookup: LookupFunction = (hostname, opts, callback) => {
      const family = typeof opts === 'object' && opts !== null ? opts.family : 0;
      const all = typeof opts === 'object' && opts !== null ? Boolean(opts.all) : false;

      let candidates = pinned;
      if (family === 4) candidates = pinned.filter((a) => isIP(a) === 4);
      else if (family === 6) candidates = pinned.filter((a) => isIP(a) === 6);

      if (candidates.length === 0) candidates = pinned;

      if (all) {
        callback(
          null,
          candidates.map((address) => ({ address, family: isIP(address) as 4 | 6 })),
        );
        return;
      }

      const address = candidates[0];
      if (!address) {
        callback(new Error(`No pinned address for ${hostname}`), '');
        return;
      }
      callback(null, address, isIP(address) as 4 | 6);
    };

    if (protocol === 'https') {
      return new https.Agent({ lookup });
    }
    return new http.Agent({ lookup });
  }
}
