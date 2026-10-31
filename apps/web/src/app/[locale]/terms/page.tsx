import { LegalPage, legalMetadata } from "@/components/LegalPage";

type Props = { params: Promise<{ locale: string }> };

export const generateMetadata = ({ params }: Props) => legalMetadata("terms", params);

export default function Page({ params }: Props) {
  return <LegalPage doc="terms" params={params} />;
}
