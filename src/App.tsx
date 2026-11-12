import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";

// The studio pulls in the background-removal library; load it only on that page.
const Studio = lazy(() => import("./pages/Studio"));

function Home() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-4xl font-bold">Multishop</h1>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route
        path="/studio"
        element={
          <Suspense fallback={<p className="p-4">Загружаю…</p>}>
            <Studio />
          </Suspense>
        }
      />
    </Routes>
  );
}
