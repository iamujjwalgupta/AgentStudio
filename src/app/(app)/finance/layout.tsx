import "./finance.css";
import FinanceProvider from "@/components/finance/FinanceProvider";

/** Finance Personas and Value Stream: content from the Finance Command Centre. */
export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return <FinanceProvider>{children}</FinanceProvider>;
}
