import { ProjectFrame } from '@/features/projects/ProjectFrame';

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  return <ProjectFrame projectKey={key.toUpperCase()}>{children}</ProjectFrame>;
}
