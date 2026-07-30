import { IntegrationProvider, IntegrationResult } from './integration-provider.interface';

export interface InvoiceData {
  invoiceNumber: string;
  customerName: string;
  customerEmail?: string;
  items: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  dueDate?: string;
  notes?: string;
}

export interface ExpenseData {
  vendorName: string;
  amount: number;
  currency: string;
  category: string;
  date: string;
  description?: string;
  reference?: string;
}

export interface AccountingProvider extends IntegrationProvider {
  createInvoice(data: InvoiceData): Promise<IntegrationResult<{ id: string; url?: string }>>;
  createExpense(data: ExpenseData): Promise<IntegrationResult<{ id: string }>>;
  getSyncStatus(): Promise<IntegrationResult<{ lastSyncAt: string | null; pendingItems: number }>>;
}
