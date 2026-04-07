import os
import sqlite3
import math
import struct
import base64
import re
import numpy as np
from datetime import datetime
from io import BytesIO
from flask import Flask, render_template, request, session, redirect, url_for, flash, jsonify, send_file
from werkzeug.security import generate_password_hash, check_password_hash
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'super_secret_production_key_for_floating_point_analyzer')
DATABASE = 'database.db'

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            expression TEXT NOT NULL,
            method TEXT NOT NULL,
            precision INTEGER NOT NULL,
            exact_value REAL NOT NULL,
            approx_value REAL NOT NULL,
            abs_error REAL NOT NULL,
            rel_error REAL NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            expression TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')
    conn.commit()
    conn.close()

# Safe evaluation environment
ALLOWED_MATH = {
    'sin': np.sin, 'cos': np.cos, 'tan': np.tan,
    'log': np.log, 'exp': np.exp, 'pi': np.pi, 'e': np.e,
    'sqrt': np.sqrt, 'abs': np.abs
}

def safe_eval(expression):
    try:
        val = eval(expression, {"__builtins__": {}}, ALLOWED_MATH)
        return float(val)
    except Exception as e:
        raise ValueError(f"Invalid expression: {str(e)}")

def float_to_binary(num):
    # Pack float into 8 bytes (64-bit IEEE 754 double precision)
    packed = struct.pack('!d', float(num))
    binary_str = ''.join(f'{byte:08b}' for byte in packed)
    
    # 1 bit sign, 11 bits exponent, 52 bits mantissa
    sign = binary_str[0]
    exponent = binary_str[1:12]
    mantissa = binary_str[12:]
    return {'sign': sign, 'exponent': exponent, 'mantissa': mantissa, 'raw': binary_str}

def get_taylor_series(expression):
    # Very basic Taylor approximation specifically for standard functions if formatted like func(val)
    match = re.match(r'^(sin|cos|exp)\(([\-\.\d]+)\)$', expression.replace(' ', ''))
    if not match:
        return None
    
    func, val_str = match.groups()
    x = float(val_str)
    
    # Generate 5 terms for visual comparison
    terms = []
    approx = 0.0
    for n in range(5):
        if func == 'exp':
            term = (x ** n) / math.factorial(n)
        elif func == 'sin':
            term = ((-1)**n) * (x ** (2*n + 1)) / math.factorial(2*n + 1)
        elif func == 'cos':
            term = ((-1)**n) * (x ** (2*n)) / math.factorial(2*n)
            
        approx += term
        exact = safe_eval(expression)
        err = abs(exact - approx)
        terms.append({
            'n': n + 1,
            'term_val': float(term),
            'current_approx': float(approx),
            'error': float(err)
        })
    return terms

def generate_explanation(expression, exact, approx, abs_error, rel_error, method, precision):
    # Error classification
    severity = "Low"
    if rel_error > 0.05: severity = "High"
    elif rel_error > 0.001: severity = "Medium"
    
    classification = f"Severity: {severity} | Dominant Error: {'Truncation' if method == 'truncation' else 'Rounding'}"
    explanation = f"[{classification}]\n"
    
    if abs_error == 0:
        explanation += f"The expression was evaluated perfectly at {precision} decimal places. Integers or exact fractional powers of 2 represent perfectly in binary formats."
    else:
        explanation += f"An absolute error of {abs_error:.4e} was introduced. "
        if method == 'rounding':
            explanation += f"Rounding to {precision} decimal places pushes the value to the nearest boundary. "
        else:
            explanation += f"Truncation chops off sub-scale metrics past {precision} places, which consistently underestimates magnitude. "
    
    # Real world impact tie-in
    explanation += "\nReal-World Impact: "
    if severity == "High":
        explanation += "In rendering engines, an error this large causes visible Z-fighting. In finance, it would result in catastrophic cent-drift over compound interest scales."
    elif severity == "Medium":
        explanation += "Machine Learning models (like neural nets computing softmax) might suffer compounding confidence issues under this precision drift."
    else:
        explanation += "This precision is mostly stable, standard for collision detection engines or generic graphics transforms."
        
    return explanation

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/about')
def about():
    return render_template('about.html')

@app.route('/theory')
def theory():
    return render_template('theory.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    # Keep as original ...
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        if not username or not password:
            flash('Required fields missing', 'error')
            return redirect(url_for('register'))
            
        conn = get_db_connection()
        user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
        if user:
            flash('Username exists', 'error')
            conn.close()
            return redirect(url_for('register'))
            
        hashed_pw = generate_password_hash(password)
        conn.execute('INSERT INTO users (username, password) VALUES (?, ?)', (username, hashed_pw))
        conn.commit()
        conn.close()
        flash('Registration successful!', 'success')
        return redirect(url_for('login'))
    return render_template('register.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        conn = get_db_connection()
        user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
        conn.close()
        if user and check_password_hash(user['password'], password):
            session['user_id'] = user['id']
            session['username'] = user['username']
            return redirect(url_for('analyzer'))
        else:
            flash('Incorrect username/password', 'error')
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

@app.route('/analyzer')
def analyzer():
    if 'user_id' not in session:
        return redirect(url_for('login'))
        
    conn = get_db_connection()
    favs = conn.execute('SELECT * FROM favorites WHERE user_id = ?', (session['user_id'],)).fetchall()
    conn.close()
    
    return render_template('analyzer.html', favorites=favs)

@app.route('/toggle-favorite', methods=['POST'])
def toggle_favorite():
    if 'user_id' not in session: return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.get_json()
    expr = data.get('expression')
    
    conn = get_db_connection()
    existing = conn.execute('SELECT id FROM favorites WHERE user_id = ? AND expression = ?', (session['user_id'], expr)).fetchone()
    
    if existing:
        conn.execute('DELETE FROM favorites WHERE id = ?', (existing['id'],))
        action = 'removed'
    else:
        conn.execute('INSERT INTO favorites (user_id, expression) VALUES (?, ?)', (session['user_id'], expr))
        action = 'added'
    
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'action': action})

@app.route('/analyze', methods=['POST'])
def analyze():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.get_json()
    expression = data.get('expression')
    method = data.get('method', 'rounding')
    precision = int(data.get('precision', 5))
    
    if not expression: return jsonify({'error': 'Required'}), 400
    
    try:
        exact_val = np.float64(safe_eval(expression))
        
        # Binary Representation of exact value
        ieee_754 = float_to_binary(exact_val)
        
        # Taylor support
        taylor_data = get_taylor_series(expression)
        
        if method == 'rounding':
            approx_val = np.round(exact_val, precision)
        else:
            factor = 10.0 ** precision
            approx_val = np.trunc(exact_val * factor) / factor
            
        abs_error = np.abs(exact_val - approx_val)
        rel_error = 0.0 if exact_val == 0 else np.abs(abs_error / exact_val)
        explanation = generate_explanation(expression, exact_val, approx_val, abs_error, rel_error, method, precision)
        
        # Only log to history if it's explicitly submitted via button, not auto-typing
        is_live_typing = data.get('isLiveTyping', False)
        if not is_live_typing:
            conn = get_db_connection()
            conn.execute('''
                INSERT INTO history (user_id, expression, method, precision, exact_value, approx_value, abs_error, rel_error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (session['user_id'], expression, method, precision, float(exact_val), float(approx_val), float(abs_error), float(rel_error)))
            conn.commit()
            conn.close()
        
        # Chart and Step-by-step array calculation
        graph_data = {'labels': list(range(1, 11)), 'rounding': [], 'truncation': []}
        step_data = []
        
        for p in range(1, 11):
            r_val = float(np.round(exact_val, p))
            factor = 10.0 ** p
            t_val = float(np.trunc(exact_val * factor) / factor)
            
            err_r = float(np.abs(exact_val - r_val))
            err_t = float(np.abs(exact_val - t_val))
            
            graph_data['rounding'].append(err_r)
            graph_data['truncation'].append(err_t)
            
            step_data.append({
                'precision': p,
                'rounded': r_val,
                'truncated': t_val,
                'error_r': err_r,
                'error_t': err_t
            })
            
        # Optional 3D surface plot data preparation (Precision vs Input Value offset vs Error)
        # We will map variations of X (scaling) vs precision to map topological errors
        surface_z = []
        for x_variation in np.linspace(exact_val * 0.5, exact_val * 1.5, 10):
            row_errors = []
            for p in range(1, 11):
                r_val_v = float(np.round(x_variation, p))
                row_errors.append(float(np.abs(x_variation - r_val_v)))
            surface_z.append(row_errors)

        return jsonify({
            'success': True,
            'result': {
                'exact': float(exact_val), 'approx': float(approx_val),
                'abs_error': float(abs_error), 'rel_error': float(rel_error),
                'explanation': explanation, 'ieee': ieee_754,
                'taylor': taylor_data
            },
            'graph_data': graph_data,
            'step_data': step_data,
            'surface_z': surface_z,
            'surface_x': list(range(1, 11)),
            'surface_y': list(np.linspace(exact_val * 0.5, exact_val * 1.5, 10))
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/analyze-compare', methods=['POST'])
def analyze_compare():
    if 'user_id' not in session: return jsonify({'error': 'Unauthorized'}), 401
    
    expressions = request.json.get('expressions', [])
    if len(expressions) > 3: return jsonify({'error': 'Max 3 expressions'}), 400
    
    datasets = []
    
    for idx, expr in enumerate(expressions):
        try:
            exact_val = np.float64(safe_eval(expr))
            errors = []
            for p in range(1, 11):
                r_val = float(np.round(exact_val, p))
                errors.append(float(np.abs(exact_val - r_val)))
            datasets.append({
                'label': f'Round Err: {expr}',
                'data': errors,
                'exact': exact_val
            })
        except Exception as e:
            datasets.append({'label': f'Error in {expr}', 'data': [0]*10})
            
    return jsonify({'success': True, 'datasets': datasets, 'labels': list(range(1, 11))})

@app.route('/download-single', methods=['POST'])
def download_single_report():
    if 'user_id' not in session: return redirect(url_for('login'))
    data = request.json
    
    image_b64 = data.get('image', '').split(',')[-1]
    msg = data.get('text', '')
    
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    elements = []
    styles = getSampleStyleSheet()
    
    elements.append(Paragraph(f"Single Analysis Report Generated for {session.get('username')}", styles['Title']))
    elements.append(Spacer(1, 12))
    
    title_style = styles['Heading3']
    elements.append(Paragraph("Diagnostic Summary:", title_style))
    for segment in msg.split('\n'):
        elements.append(Paragraph(segment, styles['Normal']))
        elements.append(Spacer(1, 8))
        
    elements.append(Spacer(1, 12))
    
    if image_b64:
        img_buffer = BytesIO(base64.b64decode(image_b64))
        # Embed chart image
        try:
            img = Image(img_buffer, width=400, height=250)
            elements.append(img)
        except Exception as e:
            print("Image conversion failed", e)
            
    doc.build(elements)
    buffer.seek(0)
    return send_file(buffer, as_attachment=True, download_name='single_analysis.pdf', mimetype='application/pdf')

@app.route('/history')
def history():
    if 'user_id' not in session: return redirect(url_for('login'))
    conn = get_db_connection()
    history_records = conn.execute('SELECT * FROM history WHERE user_id = ? ORDER BY timestamp DESC', (session['user_id'],)).fetchall()
    conn.close()
    return render_template('history.html', history=history_records)

@app.route('/download-history')
def download_history():
    if 'user_id' not in session: return redirect(url_for('login'))
    conn = get_db_connection()
    records = conn.execute('SELECT * FROM history WHERE user_id = ? ORDER BY timestamp DESC', (session['user_id'],)).fetchall()
    conn.close()
    
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    elements = [Paragraph(f"Analysis History", getSampleStyleSheet()['Title']), Spacer(1, 12)]
    
    data = [['Expression', 'Method', 'Precision', 'Exact', 'Abs Error']]
    for r in records:
        data.append([r['expression'], r['method'], str(r['precision']), f"{r['exact_value']:.4f}", f"{r['abs_error']:.2e}"])
    t = Table(data)
    elements.append(t)
    doc.build(elements)
    buffer.seek(0)
    return send_file(buffer, as_attachment=True, download_name='fp_history.pdf', mimetype='application/pdf')

init_db()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=False, host='0.0.0.0', port=port)
