import { ImagineStudio } from '@/components/imagine-studio'

export const metadata = {
  title: 'Imagine — Nelth-IA',
  description: 'Créez des images et des vidéos à partir de vos idées.'
}

export default function ImaginePage() {
  // Frontend only for now — generation backend wiring comes next.
  return <ImagineStudio />
}
