'use client';

import { useState, useEffect } from 'react';
import { claimsApi } from '@/services/api';
import { ProtectedRoute } from '@/components/ProtectedRoute';

function AnalyticsContent() {
  const [stats, setStats] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await claimsApi.getStats();
      setStats(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load analytics';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const pct = (n: number) =>
    stats?.total > 0 ? ((n || 0) / stats.total) * 100 : 0;

  return (
    <main className="ml-64 min-h-screen p-12 bg-background">
      <header className="mb-16">
        <span className="text-[10px] tracking-[0.3em] text-primary uppercase font-bold mb-4 block">
          Your verification history
        </span>
        <h2 className="text-5xl font-black font-display tracking-tight text-on-surface">
          Analytics
        </h2>
        <div className="w-24 h-1.5 bg-primary mt-6"></div>
      </header>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      ) : error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded text-red-700 mb-12">
          {error}
        </div>
      ) : (
        <>
          <section className="grid grid-cols-1 md:grid-cols-4 gap-px bg-surface-container-highest mb-20">
            {[
              { label: "Total Claims Verified", val: stats?.total || 0, note: "All time" },
              {
                label: "Accuracy Rate",
                val: stats?.total > 0 ? `${pct(stats?.accurate || 0).toFixed(1)}%` : "0%",
                note: "Accurate / total",
              },
              { label: "Misleading Claims", val: stats?.misleading || 0, note: "Flagged misleading" },
              { label: "False Claims", val: stats?.false || 0, note: "Flagged false" },
            ].map((stat) => (
              <div key={stat.label} className="bg-white p-8 group">
                <p className="text-[10px] tracking-widest text-on-surface-variant uppercase font-bold mb-6">
                  {stat.label}
                </p>
                <h3 className="text-4xl font-black font-display text-on-surface group-hover:text-primary transition-colors">
                  {stat.val}
                </h3>
                <p className="mt-4 text-xs font-bold text-on-surface-variant">{stat.note}</p>
              </div>
            ))}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-20">
            <div className="space-y-8">
              <h4 className="text-xl font-black font-display text-on-surface border-l-4 border-primary pl-4">
                Verdict Distribution
              </h4>
              <div className="bg-surface-container-low p-8 flex flex-col justify-center">
                <div className="space-y-6">
                  {[
                    { label: "Accurate", value: stats?.accurate || 0, color: "bg-green-600", textColor: "text-green-600" },
                    { label: "Misleading", value: stats?.misleading || 0, color: "bg-yellow-600", textColor: "text-yellow-600" },
                    { label: "False", value: stats?.false || 0, color: "bg-red-600", textColor: "text-red-600" },
                    { label: "Unverifiable", value: stats?.unverifiable || 0, color: "bg-gray-400", textColor: "text-gray-600" },
                  ].map((item) => {
                    const share = pct(item.value);
                    return (
                      <div key={item.label} className="space-y-2">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider">
                          <span>{item.label}</span>
                          <span className={item.textColor}>
                            {item.value} ({share.toFixed(1)}%)
                          </span>
                        </div>
                        <div className="h-2 bg-surface-container-highest">
                          <div
                            className={`h-full ${item.color}`}
                            style={{ width: `${Math.max(share, item.value > 0 ? 2 : 0)}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-8">
              <h4 className="text-xl font-black font-display text-on-surface border-l-4 border-primary pl-4">
                Summary
              </h4>
              <div className="space-y-4">
                {[
                  { label: "Total", value: stats?.total || 0 },
                  {
                    label: "Avg Confidence",
                    value: stats?.avg_confidence
                      ? `${Math.round(parseFloat(stats.avg_confidence) * 100)}%`
                      : "0%",
                  },
                  { label: "Status", value: stats?.total > 0 ? "Active" : "No claims yet" },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="bg-surface-container-low p-6 flex items-center justify-between"
                  >
                    <p className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant">
                      {item.label}
                    </p>
                    <p className="text-lg font-black font-display text-on-surface">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

export default function AnalyticsPage() {
  return (
    <ProtectedRoute>
      <AnalyticsContent />
    </ProtectedRoute>
  );
}
