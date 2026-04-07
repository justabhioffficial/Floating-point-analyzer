function setExample(expr) {
    document.getElementById('expression').value = expr;
    triggerManualLog();
}

// Feature 9: Toggle Favorite
async function toggleFavorite() {
    const expression = document.getElementById('expression').value;
    if(!expression) return;
    try {
        const response = await fetch('/toggle-favorite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expression })
        });
        if(response.ok) {
            window.location.reload(); // Reload to update pill view
        }
    } catch(e) { console.error('Failed to favorite', e); }
}

let isComparisonMode = false;
function toggleComparisonMode() {
    isComparisonMode = document.getElementById('comparison-mode').checked;
    if(isComparisonMode) {
        document.getElementById('primary-input-group').style.display = 'none';
        document.getElementById('secondary-input-group').style.display = 'block';
        document.getElementById('settings-row').style.display = 'none';
        document.getElementById('analyze-btn').style.display = 'none';
        document.getElementById('step-panel').style.display = 'none';
    } else {
        document.getElementById('primary-input-group').style.display = 'block';
        document.getElementById('secondary-input-group').style.display = 'none';
        document.getElementById('settings-row').style.display = 'flex';
        document.getElementById('analyze-btn').style.display = 'block';
    }
}

// Feature 7: Live Typing Debounce
let debounceTimer;
document.addEventListener('DOMContentLoaded', () => {
    
    // Theme logic integration
    const themeBtn = document.getElementById('theme-toggle');
    const root = document.documentElement;
    const currentTheme = localStorage.getItem('theme') || 'dark';
    if(currentTheme === 'light') {
        root.setAttribute('data-theme', 'light');
        if(themeBtn) themeBtn.textContent = '🌙 Dark Mode';
    }

    if(themeBtn) {
        themeBtn.addEventListener('click', () => {
            const newTheme = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
            root.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            themeBtn.textContent = newTheme === 'light' ? '🌙 Dark Mode' : '☀️ Light Mode';
        });
    }

    const primaryInput = document.getElementById('expression');
    if (primaryInput) {
        primaryInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if(primaryInput.value.length > 0) {
                    executeAnalysis(true); // isLiveTyping=true
                }
            }, 600);
        });
    }
    
    // Feature 3: Download Single Result PDF
    const downloadPdfBtn = document.getElementById('download-single-pdf');
    if(downloadPdfBtn) {
        downloadPdfBtn.addEventListener('click', async () => {
            const canvas = document.getElementById('errorChart');
            
            // Reconstruct background for export
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            const ctx = tempCanvas.getContext('2d');
            ctx.fillStyle = '#0f172a'; 
            ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            ctx.drawImage(canvas, 0, 0);
            
            const imageBase64 = tempCanvas.toDataURL('image/png');
            const explanation = document.getElementById('ai-text').textContent;
            
            downloadPdfBtn.textContent = 'Generating...';
            try {
                const response = await fetch('/download-single', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: imageBase64, text: explanation })
                });
                
                if(response.ok) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'single_analysis.pdf';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                }
            } catch(e) { console.error(e); }
            downloadPdfBtn.textContent = '📄 Export PDF';
        });
    }
});

function triggerManualLog() {
    executeAnalysis(false); // isLiveTyping=false saves to DB
}

async function executeAnalysis(isLiveTyping) {
    if(isComparisonMode) return;
    
    const expression = document.getElementById('expression').value;
    const method = document.getElementById('method').value;
    const precision = document.getElementById('precision').value;
    
    document.getElementById('loading').style.display = 'block';
    if(isLiveTyping) document.getElementById('error-alert').style.display = 'none';
    
    try {
        const response = await fetch('/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expression, method, precision, isLiveTyping })
        });
        const data = await response.json();
        
        document.getElementById('loading').style.display = 'none';
        
        if (!response.ok || data.error) {
            if(!isLiveTyping) {
                const el = document.getElementById('error-alert');
                el.textContent = data.error || 'Invalid expression syntax.';
                el.style.display = 'block';
            }
            return;
        }
        
        document.getElementById('error-alert').style.display = 'none';
        
        // Populate results
        document.getElementById('val-exact').textContent = data.result.exact;
        document.getElementById('val-approx').textContent = data.result.approx;
        document.getElementById('val-abs').textContent = data.result.abs_error.toExponential(4);
        document.getElementById('val-rel').textContent = data.result.rel_error.toExponential(4);
        
        let explanationText = data.result.explanation;
        if(data.result.taylor) {
             explanationText += "\n\nTaylor Series Convergence vs Exact:\n";
             data.result.taylor.forEach(t => {
                 explanationText += `Term ${t.n}: approx=${t.current_approx.toFixed(6)}, error=${t.error.toExponential(2)}\n`;
             });
        }
        document.getElementById('ai-text').textContent = explanationText;
        
        // Population IEEE
        document.getElementById('ieee-sign').textContent = data.result.ieee.sign;
        document.getElementById('ieee-exp').textContent = data.result.ieee.exponent;
        document.getElementById('ieee-man').textContent = data.result.ieee.mantissa;
        
        // Feature 8 Warning
        const warningEl = document.getElementById('precision-warning');
        if(precision < 4 && data.result.rel_error > 0.01) {
            warningEl.style.display = 'block';
        } else {
            warningEl.style.display = 'none';
        }
        
        document.getElementById('results-panel').style.display = 'block';
        document.getElementById('graph-panel').style.display = 'block';
        document.getElementById('3d-panel').style.display = 'block';
        document.getElementById('step-panel').style.display = 'block';
        
        // Populate Table Step-by-Step with animation delay
        const tbody = document.getElementById('step-table-body');
        tbody.innerHTML = '';
        data.step_data.forEach((step, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>P: ${step.precision}</td>
                <td>${step.rounded}</td>
                <td>${step.truncated}</td>
                <td class="error-text">${step.error_r.toExponential(2)}</td>
            `;
            tbody.appendChild(tr);
            
            setTimeout(() => {
                tr.classList.add('visible');
            }, 50 * index);
        });
        
        if (typeof renderGraph === 'function') renderGraph(data.graph_data, 'single');
        if (typeof render3D === 'function') render3D(data.surface_x, data.surface_y, data.surface_z);
        
    } catch (error) {
        document.getElementById('loading').style.display = 'none';
        console.error(error);
    }
}

// Feature 2: Run Comparison for multiple strings
async function runComparison() {
    const expressionsStr = document.getElementById('multi-expression').value;
    const expressions = expressionsStr.split(',').map(s => s.trim()).filter(s => s);
    if(expressions.length === 0) return;
    
    document.getElementById('loading').style.display = 'block';
    try {
        const response = await fetch('/analyze-compare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expressions })
        });
        const data = await response.json();
        document.getElementById('loading').style.display = 'none';
        
        if (response.ok && data.success) {
            document.getElementById('graph-panel').style.display = 'block';
            document.getElementById('results-panel').style.display = 'none';
            document.getElementById('3d-panel').style.display = 'none';
            document.getElementById('step-panel').style.display = 'none';
            if (typeof renderGraph === 'function') renderGraph(data, 'compare');
        }
    } catch (e) { console.error(e); }
}
