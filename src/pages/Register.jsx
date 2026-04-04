import { Link } from 'react-router-dom';

export default function Register() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-2">
          <div className="w-7 h-7 bg-brand-600 rounded-md flex items-center justify-center text-white font-bold text-sm">W</div>
          <span className="font-semibold text-slate-800">Website Health Report</span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="card max-w-md w-full text-center">
          <div className="text-4xl mb-4">📬</div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">Coming soon</h1>
          <p className="text-slate-500 text-sm mb-6">
            Account registration is under development. Once live, you'll be able to set up weekly health report emails for your sites.
          </p>
          <Link to="/" className="text-brand-600 text-sm hover:underline">← Back to scan</Link>
        </div>
      </main>
    </div>
  );
}
