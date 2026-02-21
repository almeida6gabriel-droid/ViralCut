import { DashboardApp } from "@/components/dashboard-app";

interface DashboardPageProps {
  searchParams?: Promise<{
    job?: string;
  }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = (await searchParams) ?? {};
  return <DashboardApp initialJobId={params.job} />;
}
