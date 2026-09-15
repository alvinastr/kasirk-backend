export interface ReportDateRange {
  start: Date;
  end: Date;
}

export interface DailySalesReport {
  date: string;
  outlet_id: string | null;
  transaction_count: number;
  gross_sales: number;
  discount: number;
  net_sales: number;
  tax_collected: number;
  total_sales: number;
  cogs: number;
  gross_profit: number;
}

export interface SalesSummaryReport {
  transaction_count: number;
  gross_sales: number;
  discount: number;
  net_sales: number;
  tax_collected: number;
  total_sales: number;
  cogs: number;
  gross_profit: number;
  average_transaction: number;
}

export interface TopProductReport {
  product_id: string;
  product_name: string;
  sku: string;
  quantity_sold: number;
  gross_sales: number;
  cogs: number;
  gross_profit: number;
}
