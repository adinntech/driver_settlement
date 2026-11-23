import MainLayout from "@/layouts/MainLayout";
import BackendStatus from "@/components/BackendStatus";

export default function Home() {
  return (
    <MainLayout>
      <section className="hero">
        <h1>Driver Settlement</h1>
        <p>Project setup is complete. Application features will be added soon.</p>
        <BackendStatus />
      </section>
    </MainLayout>
  );
}
