let errorChartInstance = null;
let currentScale = 'logarithmic';

const colorPalette = [
    '#0ea5e9', '#d946ef', '#10b981', '#f59e0b', '#ef4444'
];

function toggleScale() {
    currentScale = (currentScale === 'logarithmic') ? 'linear' : 'logarithmic';
    document.getElementById('toggle-scale-btn').textContent = (currentScale === 'logarithmic') ? '📈 Use Linear Scale' : '📉 Use Log Scale';
    
    if(errorChartInstance) {
        errorChartInstance.options.scales.y.type = currentScale;
        errorChartInstance.update();
    }
}

function renderGraph(graphData, mode='single') {
    const ctx = document.getElementById('errorChart').getContext('2d');
    if (errorChartInstance) errorChartInstance.destroy();
    
    Chart.defaults.color = '#94a3b8';
    if(Chart.defaults.font) {
        Chart.defaults.font.family = "'Outfit', sans-serif";
        Chart.defaults.font.size = 13;
    }
    
    let datasets = [];
    
    if(mode === 'single') {
        datasets = [
            {
                label: 'Rounding Error',
                data: graphData.rounding,
                borderColor: '#0ea5e9', 
                backgroundColor: 'rgba(14, 165, 233, 0.1)',
                borderWidth: 3, 
                pointBackgroundColor: '#0ea5e9',
                pointBorderColor: '#fff',
                pointHoverRadius: 6,
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: '#0ea5e9',
                tension: 0.4, fill: true
            },
            {
                label: 'Truncation Error',
                data: graphData.truncation,
                borderColor: '#ef4444', 
                backgroundColor: 'rgba(239, 68, 68, 0.05)',
                borderWidth: 3, 
                pointBackgroundColor: '#ef4444',
                pointBorderColor: '#fff',
                pointHoverRadius: 6,
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: '#ef4444',
                borderDash: [6, 6], tension: 0.4, fill: false
            }
        ];
    } else if (mode === 'compare') {
        datasets = graphData.datasets.map((ds, i) => {
            let color = colorPalette[i % colorPalette.length];
            return {
                label: ds.label,
                data: ds.data,
                borderColor: color,
                backgroundColor: 'transparent',
                borderWidth: 3, 
                pointBackgroundColor: color,
                pointBorderColor: '#fff',
                pointHoverRadius: 6,
                tension: 0.4, fill: false
            };
        });
    }
    
    errorChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: graphData.labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 10, right: 20, bottom: 10, left: 10 } },
            scales: {
                y: {
                    type: currentScale,
                    title: { display: true, text: `Absolute Error (${currentScale})`, font: {weight: 'bold'} },
                    grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false }
                },
                x: {
                    title: { display: true, text: 'Precision Bounds (1-10)', font: {weight: 'bold'} },
                    grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false }
                }
            },
            plugins: {
                legend: { 
                    position: 'top', 
                    labels: { usePointStyle: true, boxWidth: 8, padding: 20, font: {weight: '600'} } 
                },
                tooltip: { 
                    mode: 'index', 
                    intersect: false,
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleFont: {size: 14},
                    bodyFont: {size: 13, family: 'monospace'},
                    padding: 12,
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) label += context.parsed.y.toExponential(4);
                            return label;
                        }
                    }
                }
            },
            interaction: { mode: 'nearest', axis: 'x', intersect: false }
        }
    });
}

function render3D(x_line, y_line, z_surface) {
    if(typeof Plotly === 'undefined') return;
    
    const data = [{
        z: z_surface,
        x: x_line,
        y: y_line,
        type: 'surface',
        // High contrast neon scale suitable for dark theme
        colorscale: 'Plasma',
        contours: {
            z: { show:true, usecolormap: true, highlightcolor:"#0ea5e9", project:{z: true} },
            x: { show:true, highlightcolor:"#d946ef", project:{x: true} }
        },
        lighting: {
            roughness: 0.5,
            ambient: 0.6,
            diffuse: 0.8
        }
    }];
    
    const layout = {
        title: '',
        autosize: true,
        margin: { l: 0, r: 0, b: 0, t: 0 },
        scene: {
            xaxis: {
                title: 'Precision Limit', 
                gridcolor: 'rgba(255,255,255,0.1)',
                zerolinecolor: 'rgba(255,255,255,0.2)',
                backgroundcolor: 'rgba(5,11,20,0.5)',
                showbackground: true
            },
            yaxis: {
                title: 'Input Variation',
                gridcolor: 'rgba(255,255,255,0.1)',
                zerolinecolor: 'rgba(255,255,255,0.2)',
                backgroundcolor: 'rgba(5,11,20,0.5)',
                showbackground: true
            },
            zaxis: {
                title: 'Absolute Error Base', 
                type: currentScale === 'logarithmic' ? 'log' : 'linear',
                gridcolor: 'rgba(255,255,255,0.1)',
                zerolinecolor: 'rgba(255,255,255,0.2)',
                backgroundcolor: 'rgba(5,11,20,0.5)',
                showbackground: true
            },
            camera: {
                eye: {x: -1.5, y: -1.5, z: 1.2}
            }
        },
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: '#94a3b8', family: "'Outfit', sans-serif" }
    };
    
    Plotly.newPlot('plotly-3d-div', data, layout, {responsive: true, displayModeBar: false});
}

document.addEventListener('DOMContentLoaded', () => {
    const downloadBtn = document.getElementById('download-graph');
    if(downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            const canvas = document.getElementById('errorChart');
            if(!canvas) return;
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width; tempCanvas.height = canvas.height;
            const ctx = tempCanvas.getContext('2d');
            // Matching the new supreme dark background
            ctx.fillStyle = '#050b14'; 
            ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            ctx.drawImage(canvas, 0, 0);
            
            const imageUrl = tempCanvas.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = imageUrl;
            a.download = 'premium_error_chart.png';
            document.body.appendChild(a);
            a.click();
            a.remove();
        });
    }
});
