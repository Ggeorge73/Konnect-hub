import { ProjectOverview } from '@/features/projects/ProjectOverview';
import { AiSettingsCard } from '@/features/ai/AiSettingsCard';
import { CommercialCard } from '@/features/integrations/CommercialCard';
export default function Page() {
  return (
    <>
      <ProjectOverview />
      <CommercialCard />
      <AiSettingsCard />
    </>
  );
}
