import { useEffect, useRef } from 'react'
import { Chart, BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Legend, Tooltip } from 'chart.js'
Chart.register(BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Legend, Tooltip)
type Dataset = { label: string; data: number[]; borderColor: string; backgroundColor: string }
export default function AnalyticsChart({ title, type = 'bar', labels, datasets, description }: { title: string; type?: 'bar' | 'line'; labels: string[]; datasets: Dataset[]; description: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const signature = JSON.stringify({ type, labels, datasets })
  useEffect(() => {
    if (!canvas.current) return
    const chart = new Chart(canvas.current, { type, data: { labels, datasets }, options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { position: 'bottom' } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { ticks: { maxTicksLimit: 6, maxRotation: 45 } } },
    } })
    return () => chart.destroy()
  }, [signature])
  return <section className="analytics-chart-card"><h2>{title}</h2><p>{description}</p><div className="analytics-chart-canvas"><canvas ref={canvas} role="img" aria-label={title}>Числовые данные доступны в таблице ниже.</canvas></div>
    <details><summary>Данные графика</summary><table className="analytics-data-table"><thead><tr><th>Период / категория</th>{datasets.map((dataset) => <th key={dataset.label}>{dataset.label}</th>)}</tr></thead><tbody>{labels.map((label, index) => <tr key={`${index}:${label}`}><th>{label}</th>{datasets.map((dataset) => <td key={dataset.label}>{dataset.data[index] ?? 0}</td>)}</tr>)}</tbody></table></details>
  </section>
}
