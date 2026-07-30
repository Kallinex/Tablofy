import { HttpException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpExceptionFilter } from '../http-exception.filter';
import { AppLoggerService } from '../../logger/logger.service';
import { CorrelationService } from '../../correlation/correlation.service';
import { ConfigService } from '@nestjs/config';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HttpExceptionFilter,
        {
          provide: AppLoggerService,
          useValue: {
            setContext: jest.fn(),
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          },
        },
        {
          provide: CorrelationService,
          useValue: {
            requestId: 'test-request-id',
            correlationId: 'test-correlation-id',
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(false),
          },
        },
      ],
    }).compile();

    filter = module.get<HttpExceptionFilter>(HttpExceptionFilter);
  });

  function createMockArgumentsHost(
    overrides: {
      url?: string;
      method?: string;
      statusCode?: number;
      correlationId?: string;
    } = {},
  ) {
    const headers: Record<string, string> = {};
    if (overrides.correlationId) {
      headers['x-correlation-id'] = overrides.correlationId;
    }

    const response = {
      statusCode: overrides.statusCode ?? 200,
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    return {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          url: overrides.url ?? '/api/v1/test',
          method: overrides.method ?? 'GET',
          headers,
          ip: '127.0.0.1',
        }),
      }),
    };
  }

  it('should return structured error response for HttpException', () => {
    const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);
    const host = createMockArgumentsHost({ url: '/api/v1/users/123' });
    const response = host.switchToHttp().getResponse();

    filter.catch(exception, host as never);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Not found',
        error: 'HttpException',
        path: '/api/v1/users/123',
        correlationId: expect.any(String),
      }),
    );
  });

  it('should return 500 for unknown exceptions', () => {
    const exception = new Error('Unexpected error');
    const host = createMockArgumentsHost();
    const response = host.switchToHttp().getResponse();

    filter.catch(exception, host as never);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Internal server error',
      }),
    );
  });

  it('should handle exception with object response', () => {
    const exception = new HttpException(
      { message: ['email is required', 'password too short'], error: 'Validation Error' },
      HttpStatus.BAD_REQUEST,
    );
    const host = createMockArgumentsHost();
    const response = host.switchToHttp().getResponse();

    filter.catch(exception, host as never);

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: expect.arrayContaining(['email is required']),
        error: 'Validation Error',
      }),
    );
  });

  it('should set X-Correlation-Id header', () => {
    const exception = new HttpException('Bad request', HttpStatus.BAD_REQUEST);
    const host = createMockArgumentsHost();
    const response = host.switchToHttp().getResponse();

    filter.catch(exception, host as never);

    expect(response.setHeader).toHaveBeenCalledWith('X-Correlation-Id', expect.any(String));
  });

  it('should use correlation ID from CorrelationService (header fallback)', () => {
    const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);
    const host = createMockArgumentsHost({ correlationId: 'client-provided-id' });
    const response = host.switchToHttp().getResponse();

    filter.catch(exception, host as never);

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'test-correlation-id' }),
    );
  });

  it('should include timestamp in response', () => {
    const exception = new HttpException('Test', HttpStatus.BAD_REQUEST);
    const host = createMockArgumentsHost();
    const response = host.switchToHttp().getResponse();

    filter.catch(exception, host as never);

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        timestamp: expect.any(String),
      }),
    );
  });

  describe('additional HTTP error cases', () => {
    it('should handle ForbiddenException', () => {
      const { ForbiddenException } = jest.requireActual('@nestjs/common');
      const exception = new ForbiddenException('Access denied');
      const host = createMockArgumentsHost();
      const response = host.switchToHttp().getResponse();

      filter.catch(exception, host as never);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          message: 'Access denied',
          error: 'Forbidden',
        }),
      );
    });

    it('should handle NotFoundException', () => {
      const { NotFoundException } = jest.requireActual('@nestjs/common');
      const exception = new NotFoundException('Resource not found');
      const host = createMockArgumentsHost();
      const response = host.switchToHttp().getResponse();

      filter.catch(exception, host as never);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    });

    it('should handle ConflictException', () => {
      const { ConflictException } = jest.requireActual('@nestjs/common');
      const exception = new ConflictException('Already exists');
      const host = createMockArgumentsHost();
      const response = host.switchToHttp().getResponse();

      filter.catch(exception, host as never);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    });

    it('should handle InternalServerErrorException', () => {
      const { InternalServerErrorException } = jest.requireActual('@nestjs/common');
      const exception = new InternalServerErrorException('Unexpected error');
      const host = createMockArgumentsHost();
      const response = host.switchToHttp().getResponse();

      filter.catch(exception, host as never);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it('should handle BadRequestException with validation messages', () => {
      const { BadRequestException } = jest.requireActual('@nestjs/common');
      const exception = new BadRequestException(['email must be valid', 'password too short']);
      const host = createMockArgumentsHost();
      const response = host.switchToHttp().getResponse();

      filter.catch(exception, host as never);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: expect.arrayContaining(['email must be valid']),
          error: 'Bad Request',
        }),
      );
    });
  });
});
