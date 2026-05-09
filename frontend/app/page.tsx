import { redirect } from 'next/navigation';

export default function Home() {
  // Default landing: send users straight to football. Sidebar handles sport switching from there.
  redirect('/football');
}
