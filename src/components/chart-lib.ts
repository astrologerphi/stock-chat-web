import { CategoryScale, Chart, Filler, LinearScale, LineController, LineElement, PointElement } from 'chart.js';

// Only what a single filled line needs; the readout above the chart replaces chart.js tooltips and legends.
Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler);

export { Chart };
