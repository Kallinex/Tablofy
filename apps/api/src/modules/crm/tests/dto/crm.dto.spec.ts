/* eslint-disable @typescript-eslint/no-explicit-any */
import { validate } from 'class-validator';
import { CreateCommunicationDto } from '../../dto/create-communication.dto';

describe('CRM DTOs', () => {
  describe('CreateCommunicationDto', () => {
    it('should pass with valid required fields', async () => {
      const dto = new CreateCommunicationDto();
      dto.channel = 'EMAIL' as any;
      dto.recipient = 'user@test.com';

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should pass with all optional fields', async () => {
      const dto = new CreateCommunicationDto();
      dto.channel = 'EMAIL' as any;
      dto.recipient = 'user@test.com';
      dto.subject = 'Welcome';
      dto.body = 'Welcome to the platform!';
      dto.customerId = '550e8400-e29b-41d4-a716-446655440000';
      dto.metadata = { source: 'signup' };

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should reject missing channel', async () => {
      const dto = new CreateCommunicationDto();
      dto.recipient = 'user@test.com';

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject missing recipient', async () => {
      const dto = new CreateCommunicationDto();
      dto.channel = 'EMAIL' as any;

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject invalid channel enum', async () => {
      const dto = new CreateCommunicationDto();
      dto.channel = 'FAX' as any;
      dto.recipient = 'user@test.com';

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject invalid UUID for customerId', async () => {
      const dto = new CreateCommunicationDto();
      dto.channel = 'EMAIL' as any;
      dto.recipient = 'user@test.com';
      dto.customerId = 'not-a-uuid';

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject non-string recipient', async () => {
      const dto = new CreateCommunicationDto();
      dto.channel = 'EMAIL' as any;
      (dto as any).recipient = 12345;

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
