    (function() {
        // ============================================================
        // CONFIGURACIÓN
        // ============================================================
        // NOTA DE SEGURIDAD: esta URL queda visible para cualquiera que vea el
        // código fuente de la página (no hay forma de ocultarla en una app 100%
        // cliente). Cualquiera con la URL puede hacer POST a este Apps Script.
        // Esto NO se puede arreglar desde este archivo: la validación debe
        // hacerse del lado del Apps Script, por ejemplo exigiendo un token
        // secreto en el body/cabecera y rechazando la petición si no coincide,
        // y/o limitando el rango de escritura de la hoja de cálculo.
        // ============================================================
        // SUPABASE
        // ============================================================
        const SUPABASE_URL = 'https://rgqlkeuzzqrmmgxtmren.supabase.co';
        const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJncWxrZXV6enFybW1neHRtcmVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NDE5NzMsImV4cCI6MjEwMjIxNzk3M30.P-Y577WPIgckmqCcy77rm-R55TDj6McQFvGayd0_yq0';
        const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        const GOOGLE_SHEETS_CSV_URL = '';
        const SCRIPT_URL = '';

        const sampleData = [
            {"Producto":"MANJAR ESPECIAL BAZO VELARDE BALDE X 20 KG","Codigo":"9010","CodigoFabrica":"50000111","Unidad Ref":"BAL/BAL","Cantidad":"15","FactorEmpaque":"1","Linea":"MANJARES: ESPECIAL","Marca":"BAZO VELARDE"},
            {"Producto":"LECHE UHT LAIVE ENTERA CAJA 946ML","Codigo":"2136","CodigoFabrica":"50001059","Unidad Ref":"CJ*12","Cantidad":"16459","FactorEmpaque":"12","Linea":"LECHES FRESCAS: ENTERO (A)","Marca":"LAIVE"}
        ];

        // ============================================================
        // ESTADO
        // ============================================================
        let currentData = [];
        let filteredData = [];
        let selectedIndex = -1;
        let pedido = [];
        let inventarioFisico = [];
        let currentFactor = 1;
        let autoRefreshTimer = null;
        let syncTimer = null;
        let sincronizando = false;

        // Identificador anónimo de este celular/navegador (no es un nombre de
        // usuario, solo sirve para que cada lote tenga un ID único al
        // combinarse con lo que cuentan otros celulares).
        const DEVICE_ID_KEY = 'iem_device_id';
        function obtenerDeviceId() {
            let id = null;
            try { id = localStorage.getItem(DEVICE_ID_KEY); } catch (e) {}
            if (!id) {
                id = 'dev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
                try { localStorage.setItem(DEVICE_ID_KEY, id); } catch (e) {}
            }
            return id;
        }
        const deviceId = obtenerDeviceId();

        // Sesión en nube (admin ve conectados y puede forzar cierre)
        let idSesionActual = null;

        async function registrarSesionActiva() {
            if (!usuarioActual) return;
            idSesionActual = (String(usuarioActual) + '_' + deviceId).slice(0, 120);
            try {
                await supabaseClient.from('sesiones_activas').upsert({
                    id: idSesionActual,
                    usuario: usuarioActual,
                    device_id: deviceId,
                    nombre_dispositivo: (navigator.userAgent || '').slice(0, 80),
                    ultimo_ping: new Date().toISOString(),
                    conectado_en: new Date().toISOString(),
                    forzar_cierre: false
                });
            } catch (e) {
                console.warn('No se pudo registrar sesión (¿falta tabla sesiones_activas?)', e);
            }
        }

        async function borrarSesionActiva() {
            if (!idSesionActual) return;
            try {
                await supabaseClient.from('sesiones_activas').delete().eq('id', idSesionActual);
            } catch (e) {}
            idSesionActual = null;
        }

        function forzarLogoutLocal(mensaje) {
            showToast(mensaje || 'Sesión cerrada.', 'error');
            try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
            const idBorrar = idSesionActual;
            usuarioActual = '';
            rolUsuario = '';
            idSesionActual = null;
            if (idBorrar) {
                supabaseClient.from('sesiones_activas').delete().eq('id', idBorrar).then(function () {});
            }
            document.body.style.overflow = '';
            const ov = document.getElementById('adminOverlay');
            if (ov) {
                ov.classList.remove('visible');
                ov.setAttribute('aria-hidden', 'true');
            }
            mostrarLogin();
        }

        // Ping cada 10s. NO reescribe forzar_cierre (bug anterior lo pisaba a false).
        setInterval(async function () {
            if (!usuarioActual || !idSesionActual) return;
            if (appContainer && appContainer.classList.contains('oculto')) return;
            try {
                const { data } = await supabaseClient
                    .from('sesiones_activas')
                    .select('forzar_cierre')
                    .eq('id', idSesionActual)
                    .maybeSingle();
                if (data && data.forzar_cierre) {
                    forzarLogoutLocal('El administrador cerró tu sesión.');
                    return;
                }
                // Solo actualiza el ping; no toca forzar_cierre
                await supabaseClient
                    .from('sesiones_activas')
                    .update({ ultimo_ping: new Date().toISOString() })
                    .eq('id', idSesionActual)
                    .eq('forzar_cierre', false);
            } catch (e) {}
        }, 10000);

        function escapeHtmlSes(s) {
            return String(s || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        async function cargarSesionesActivas() {
            const cont = document.getElementById('adminListaSesiones');
            if (!cont) return;
            cont.innerHTML = '<p class="admin-sesiones-empty">Cargando...</p>';
            const desde = new Date(Date.now() - 5 * 60 * 1000).toISOString();
            try {
                const { data, error } = await supabaseClient
                    .from('sesiones_activas')
                    .select('*')
                    .gte('ultimo_ping', desde)
                    .order('ultimo_ping', { ascending: false });
                if (error) throw error;
                if (!data || !data.length) {
                    cont.innerHTML = '<p class="admin-sesiones-empty">Nadie conectado ahora.</p>';
                    return;
                }
                cont.innerHTML = data.map(function (s) {
                    const hace = Math.max(0, Math.round((Date.now() - new Date(s.ultimo_ping).getTime()) / 1000));
                    const esEsta = (s.id === idSesionActual);
                    const etiqueta = esEsta ? ' (este dispositivo)' : '';
                    const forzada = s.forzar_cierre ? ' · cierre pendiente' : '';
                    return (
                        '<div class="admin-sesion-item">' +
                          '<div><div class="ses-user">' + escapeHtmlSes(s.usuario) + escapeHtmlSes(etiqueta) + '</div>' +
                          '<div class="ses-meta">Hace ' + hace + 's · ' + escapeHtmlSes((s.device_id || '').slice(0, 18)) + escapeHtmlSes(forzada) + '</div></div>' +
                          '<button type="button" class="btn btn-danger btn-sm btn-forzar-cierre" data-id="' + escapeHtmlSes(s.id) + '" data-self="' + (esEsta ? '1' : '0') + '">Cerrar sesión</button>' +
                        '</div>'
                    );
                }).join('');
                cont.querySelectorAll('.btn-forzar-cierre').forEach(function (btn) {
                    btn.addEventListener('click', async function () {
                        const id = btn.getAttribute('data-id');
                        const esSelf = btn.getAttribute('data-self') === '1';
                        const ok = await confirmarAccion(
                            esSelf
                                ? '¿Cerrar tu sesión en este dispositivo?'
                                : '¿Cerrar la sesión de este usuario en ese dispositivo?',
                            'Cerrar',
                            'danger'
                        );
                        if (!ok) return;
                        btn.disabled = true;
                        const { error } = await supabaseClient
                            .from('sesiones_activas')
                            .update({ forzar_cierre: true })
                            .eq('id', id);
                        if (error) {
                            showToast('No se pudo cerrar: ' + (error.message || error), 'error');
                            btn.disabled = false;
                            return;
                        }
                        if (esSelf) {
                            // Cierre inmediato en este mismo celular
                            forzarLogoutLocal('Sesión cerrada.');
                            return;
                        }
                        showToast('Sesión marcada. Se cerrará en unos segundos en ese dispositivo.', 'success');
                        cargarSesionesActivas();
                    });
                });
            } catch (e) {
                cont.innerHTML = '<p class="admin-sesiones-empty" style="color:var(--danger);">Error: ' +
                    escapeHtmlSes(e.message || e) +
                    '<br><small>¿Ejecutaste el SQL de sesiones_activas?</small></p>';
            }
        }

        // DOM
        const searchInput = document.getElementById('searchInput');
        const searchButton = document.getElementById('searchButton');
        const resultList = document.getElementById('resultList');
        const resultCount = document.getElementById('resultCount');
        const cajasCount = document.getElementById('cajasCount');
        const unidadesCount = document.getElementById('unidadesCount');
        const txtCajas = document.getElementById('txtCajas');
        const txtUnidades = document.getElementById('txtUnidades');
        const cajasGroup = document.getElementById('cajasGroup');
        const infoFactor = document.getElementById('infoFactor');
        const btnAgregar = document.getElementById('btnAgregar');
        const btnRegistrarFisico = document.getElementById('btnRegistrarFisico');
        const pedidoBody = document.getElementById('pedidoBody');
        const pedidoFoot = document.getElementById('pedidoFoot');
        const pedidoMobileList = document.getElementById('pedidoMobileList');
        const totalCajasFoot = document.getElementById('totalCajasFoot');
        const totalUnidadesFoot = document.getElementById('totalUnidadesFoot');
        const totalCajasPedido = document.getElementById('totalCajasPedido');
        const totalUnidadesPedido = document.getElementById('totalUnidadesPedido');
        const pedidoCount = document.getElementById('pedidoCount');
        const fileStatus = document.getElementById('fileStatus');
        const refreshBtn = document.getElementById('refreshDriveBtn');

        const productoActivoCard = document.getElementById('productoActivoCard');
        const paDescripcion = document.getElementById('paDescripcion');
        const paCodigo = document.getElementById('paCodigo');
        const paUnidad = document.getElementById('paUnidad');
        const paFactor = document.getElementById('paFactor');
        const paStock = document.getElementById('paStock');
        const paTotalValor = document.getElementById('paTotalValor');
        const paTotalUnidad = document.getElementById('paTotalUnidad');
        const conversionHint = document.getElementById('conversionHint');
        const btnCambiarProducto = document.getElementById('btnCambiarProducto');

        const vencBlock = document.getElementById('vencBlock');
        const vencChips = document.getElementById('vencChips');
        const selDia = document.getElementById('selDia');
        const selMes = document.getElementById('selMes');
        const yearTabs = document.getElementById('yearTabs');
        let anioSeleccionado = new Date().getFullYear();

        const diffBody = document.getElementById('diffBody');
        const diffFoot = document.getElementById('diffFoot');
        const diffMobileList = document.getElementById('diffMobileList');
        const diffCount = document.getElementById('diffCount');
        const diffTotalTeorico = document.getElementById('diffTotalTeorico');
        const diffTotalFisico = document.getElementById('diffTotalFisico');
        const diffTotalDiferencia = document.getElementById('diffTotalDiferencia');
        const diffResumen = document.getElementById('diffResumen');
        const resTeorico = document.getElementById('resTeorico');
        const resFisico = document.getElementById('resFisico');
        const resDiferencia = document.getElementById('resDiferencia');
        const resContados = document.getElementById('resContados');
        const exportDiffBtn = document.getElementById('exportDiffBtn');
        const clearDiffBtn = document.getElementById('clearDiffBtn');
        const guardarDriveBtn = document.getElementById('guardarDriveBtn');

        const exportPedidoBtn = document.getElementById('exportPedidoBtn');
        const guardarPedidoDriveBtn = document.getElementById('guardarPedidoDriveBtn');
        const limpiarPedidoBtn = document.getElementById('limpiarPedidoBtn');

        // ============================================================
        // TOAST
        // ============================================================
        function showToast(message, type = 'info') {
            const existing = document.querySelector('.toast');
            if (existing) existing.remove();
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); }, 3500);
        }

        // ============================================================
        // CONFIRMACIÓN PROPIA (reemplaza confirm() nativo, que en
        // algunos WebViews/apps embebidas no se llega a mostrar)
        // ============================================================
        const confirmOverlay = document.getElementById('confirmOverlay');
        const confirmMensaje = document.getElementById('confirmMensaje');
        const confirmCancelar = document.getElementById('confirmCancelar');
        const confirmAceptar = document.getElementById('confirmAceptar');
        let confirmResolver = null;

        function confirmarAccion(mensaje, textoAceptar, tipoAceptar) {
            confirmMensaje.textContent = mensaje;
            confirmAceptar.textContent = textoAceptar || 'Eliminar';
            confirmAceptar.classList.remove('btn-danger', 'btn-primary');
            confirmAceptar.classList.add(tipoAceptar === 'primary' ? 'btn-primary' : 'btn-danger');
            confirmOverlay.classList.add('visible');
            return new Promise(resolve => { confirmResolver = resolve; });
        }
        function cerrarConfirmacion(resultado) {
            confirmOverlay.classList.remove('visible');
            if (confirmResolver) {
                confirmResolver(resultado);
                confirmResolver = null;
            }
        }
        confirmCancelar.addEventListener('click', () => cerrarConfirmacion(false));
        confirmAceptar.addEventListener('click', () => cerrarConfirmacion(true));
        confirmOverlay.addEventListener('click', (e) => {
            if (e.target === confirmOverlay) cerrarConfirmacion(false);
        });

        // ============================================================
        // MAPEO DE CAMPOS
        // ============================================================
        function getField(item, ...aliases) {
            for (let alias of aliases) {
                if (item.hasOwnProperty(alias) && item[alias] !== undefined && item[alias] !== '') return item[alias];
            }
            const keys = Object.keys(item);
            for (let alias of aliases) {
                const lowerAlias = alias.toLowerCase();
                for (let key of keys) {
                    if (key.toLowerCase() === lowerAlias) return item[key];
                }
            }
            return '';
        }
        function getCodigo(item) { return getField(item, 'Codigo', 'Código', 'Cod. Producto', 'InventarioProductoCodigo', 'Cod'); }
        function getCodigoFabrica(item) { return getField(item, 'CodigoFabrica', 'CódigoFábrica', 'Cod. Fabrica', 'CodigoFabrica', 'CodFabrica'); }
        function getDescripcion(item) { return getField(item, 'Producto', 'Descripción', 'InventarioProductoDescripcion', 'Descripcion', 'Nombre'); }
        function getUnidadRef(item) { return getField(item, 'Unidad Ref', 'Uni. Ref.', 'Unidad', 'InventarioProductoUnidadReferenciaAbreviacion', 'UnidadRef'); }
        function getCantidad(item) {
            const val = getField(item, 'InventarioProductoCantidad', 'Cantidad', 'Stock', 'Stock Fisico');
            if (typeof val === 'string' && val.includes('/')) {
                const partes = val.split('/');
                if (partes.length > 0) return parseInt(partes[0]) || 0;
            }
            return parseFloat(val) || 0;
        }
        function getFactorEmpaque(item) {
            const val = getField(item, 'InventarioProductoUnidadReferenciaFactor', 'FactorEmpaque', 'Factor', 'UnidadRefFactor');
            return parseInt(val) || 1;
        }
        function getLinea(item) { return getField(item, 'Linea', 'Línea', 'InventarioProductoCategoriaDescripcion', 'Categoria'); }
        function getMarca(item) { return getField(item, 'Marca', 'InventarioProductoProveedorNombre', 'Proveedor'); }

        function obtenerFactorEmpaque(textoEmpaque) {
            if (!textoEmpaque) return 1;
            let factor = 1;
            // Bug #5: antes solo detectaba 'X' mayúscula; ahora es insensible a mayúsculas/minúsculas.
            let pos = textoEmpaque.indexOf('*');
            if (pos === -1) pos = textoEmpaque.toUpperCase().indexOf('X');
            if (pos !== -1) {
                let extraido = textoEmpaque.substring(pos + 1).trim();
                let numeros = extraido.replace(/\D/g, '');
                if (parseInt(numeros) > 1) factor = parseInt(numeros);
            }
            return factor;
        }

        // Bug #1: única fuente de verdad para el factor de empaque de un producto.
        // Antes renderResults() usaba solo getFactorEmpaque(item) y actualizarCantidades()
        // usaba obtenerFactorEmpaque(unidad) || getFactorEmpaque(item), pudiendo dar
        // resultados distintos para el mismo producto. Ahora ambos usan esta función.
        function getFactorFinal(item) {
            const unidad = getUnidadRef(item);
            return obtenerFactorEmpaque(unidad) || getFactorEmpaque(item) || 1;
        }

        // ============================================================
        // RESPALDO AUTOMÁTICO DE DATOS (por si se cae el link de Sheets)
        // ============================================================
        // Cada vez que la carga desde Google Sheets funciona bien, se guarda
        // una copia completa en este dispositivo. Si el link se desconecta
        // (como al reemplazar la hoja de cálculo), la app usa este respaldo
        // en vez de perder todo el inventario o mostrar datos de ejemplo.
        const BACKUP_KEY = 'buscador_respaldo_datos';

        function guardarRespaldo(data) {
            try {
                localStorage.setItem(BACKUP_KEY, JSON.stringify({
                    data: data,
                    fechaISO: new Date().toISOString()
                }));
            } catch (e) {
                // Si no se puede guardar (almacenamiento lleno/bloqueado), no es
                // crítico: simplemente no habrá respaldo la próxima vez.
                console.warn('No se pudo guardar el respaldo de datos.', e);
            }
        }

        function cargarRespaldo() {
            try {
                const raw = localStorage.getItem(BACKUP_KEY);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                if (!parsed.data || !Array.isArray(parsed.data) || parsed.data.length === 0) return null;
                return parsed;
            } catch (e) {
                return null;
            }
        }

        function formatearFechaRespaldo(fechaISO) {
            try {
                const f = new Date(fechaISO);
                return f.toLocaleDateString() + ' ' + f.toLocaleTimeString();
            } catch (e) {
                return '';
            }
        }

        // ============================================================
        // CARGA DESDE GOOGLE SHEETS
        // ============================================================
        async function loadFromGoogleSheets() {
            fileStatus.textContent = '⏳ Cargando productos desde Supabase...';
            try {
                const { data, error } = await supabaseClient
                    .from('productos')
                    .select('*')
                    .eq('activo', true)
                    .order('codigo');
                if (error) throw error;
                if (data && data.length > 0) {
                    currentData = data.map(p => ({
                        Codigo: p.codigo,
                        CodigoFabrica: p.codigo_fabrica || '',
                        Producto: p.descripcion,
                        'Unidad Ref': p.unidad_ref || '',
                        Cantidad: String(p.stock_teorico ?? 0),
                        FactorEmpaque: String(p.factor_empaque ?? 1),
                        Linea: p.linea || '',
                        Marca: p.marca || '',
                        InventarioProductoCodigo: p.codigo,
                        InventarioProductoDescripcion: p.descripcion,
                        InventarioProductoUnidadReferenciaAbreviacion: p.unidad_ref || '',
                        InventarioProductoUnidadReferenciaFactor: String(p.factor_empaque ?? 1),
                        InventarioProductoCantidad: String(p.stock_teorico ?? 0),
                        InventarioProductoCategoriaDescripcion: p.linea || '',
                        InventarioProductoProveedorNombre: p.marca || ''
                    }));
                    guardarRespaldo(currentData);
                    fileStatus.textContent = `✅ ${currentData.length} productos (Supabase)`;
                    if (!searchInput.value.trim() && selectedIndex === -1) {
                        filteredData = [];
                        renderResults([]);
                        limpiarCantidades();
                    }
                } else {
                    fileStatus.textContent = '⚠️ Sin productos en Supabase, buscando respaldo...';
                    useBackupOrLocalData();
                }
            } catch (err) {
                console.warn('Error Supabase productos:', err);
                fileStatus.textContent = '⚠️ Sin conexión, buscando respaldo...';
                useBackupOrLocalData();
            }
        }

        // Si Google Sheets falla o está vacío, primero intenta usar el último
        // respaldo bueno guardado en este dispositivo. Solo si tampoco hay
        // respaldo, cae a los datos de ejemplo.
        function useBackupOrLocalData() {
            const respaldo = cargarRespaldo();
            if (respaldo) {
                currentData = respaldo.data;
                const fechaTexto = formatearFechaRespaldo(respaldo.fechaISO);
                fileStatus.textContent = `💾 ${currentData.length} registros del último respaldo (${fechaTexto})`;
            } else {
                useLocalData();
                return;
            }
            if (!searchInput.value.trim() && selectedIndex === -1) {
                filteredData = [];
                renderResults([]);
                limpiarCantidades();
            }
        }

        function useLocalData() {
            currentData = [...sampleData];
            fileStatus.textContent = `📋 ${currentData.length} registros de ejemplo`;
            // Bug #2: mismo cuidado que en loadFromGoogleSheets, para no interrumpir
            // una búsqueda o selección en curso si esto ocurre durante el auto-refresco.
            if (!searchInput.value.trim() && selectedIndex === -1) {
                filteredData = [];
                renderResults([]);
                limpiarCantidades();
            }
        }

        // Parser CSV robusto: procesa carácter a carácter para respetar comillas
        // ("..." puede contener el delimitador o saltos de línea) y no descarta
        // filas con menos columnas (las rellena con '' en vez de perder datos).
        function parseCSVRows(csvText) {
            const rows = [];
            let row = [];
            let field = '';
            let inQuotes = false;
            let i = 0;
            const len = csvText.length;

            // Detectar delimitador a partir de la primera línea (fuera de comillas)
            let delimiter = ',';
            let firstLineEnd = csvText.search(/\r?\n/);
            const sample = firstLineEnd === -1 ? csvText : csvText.slice(0, firstLineEnd);
            if (sample.includes(';') && !sample.includes(',')) delimiter = ';';
            else if (sample.includes('\t') && !sample.includes(',')) delimiter = '\t';

            while (i < len) {
                const char = csvText[i];

                if (inQuotes) {
                    if (char === '"') {
                        if (csvText[i + 1] === '"') { field += '"'; i += 2; continue; }
                        inQuotes = false; i++; continue;
                    }
                    field += char; i++; continue;
                }

                if (char === '"') { inQuotes = true; i++; continue; }
                if (char === delimiter) { row.push(field); field = ''; i++; continue; }
                if (char === '\r') { i++; continue; }
                if (char === '\n') {
                    row.push(field); field = '';
                    rows.push(row); row = [];
                    i++; continue;
                }
                field += char; i++;
            }
            // Última celda/fila pendiente
            if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

            return rows.filter(r => r.some(v => v.trim() !== ''));
        }

        function parseCSV(csvText) {
            const rows = parseCSVRows(csvText);
            if (rows.length < 2) return null;
            const headers = rows[0].map(h => h.trim());
            const result = [];
            for (let i = 1; i < rows.length; i++) {
                const values = rows[i];
                const obj = {};
                headers.forEach((h, idx) => {
                    // Si la fila tiene menos columnas que el encabezado, se rellena
                    // con '' en vez de descartar el registro completo.
                    const v = values[idx];
                    obj[h] = v !== undefined ? v.trim() : '';
                });
                result.push(obj);
            }
            return result;
        }

        // ============================================================
        // BÚSQUEDA Y RENDER
        // ============================================================
        function performSearch() {
            const term = searchInput.value.trim();
            if (!term) {
                filteredData = [];
                renderResults([]);
                return;
            }
            const palabras = term.split(/\s+/).filter(p => p.length > 0);
            const palabrasUpper = palabras.map(p => p.toUpperCase());

            filteredData = currentData.filter(item => {
                const campos = [
                    getCodigo(item).toUpperCase(),
                    getCodigoFabrica(item).toUpperCase(),
                    getDescripcion(item).toUpperCase(),
                    getUnidadRef(item).toUpperCase(),
                    getLinea(item).toUpperCase(),
                    getMarca(item).toUpperCase()
                ];
                return palabrasUpper.every(pal => campos.some(campo => campo.includes(pal)));
            });

            renderResults(filteredData);
        }

        function renderResults(items) {
            if (!items || items.length === 0) {
                resultList.innerHTML = `<div class="empty-message">🔎 No se encontraron productos</div>`;
                resultCount.textContent = '0';
                cajasCount.textContent = '0';
                unidadesCount.textContent = '0';
                selectedIndex = -1;
                limpiarCantidades();
                return;
            }

            let html = '';
            items.forEach((item, idx) => {
                const codigo = getCodigo(item);
                const fabrica = getCodigoFabrica(item);
                const desc = getDescripcion(item);
                const unidad = getUnidadRef(item);
                const cantidad = getCantidad(item);
                const factor = getFactorFinal(item);
                const cajasStock = factor === 1 ? 0 : Math.floor(cantidad / factor);
                const unidadesStock = factor === 1 ? cantidad : cantidad % factor;
                const selectedClass = (idx === selectedIndex) ? ' selected' : '';

                html += `<div class="result-item${selectedClass}" data-index="${idx}">
                    <span class="codigo">${codigo}</span>
                    <span class="fabrica">${fabrica}</span>
                    <span class="descripcion">${desc}</span>
                    <span class="unidad">${unidad}</span>
                    <span class="stock-cajas">${cajasStock}</span>
                    <span class="stock-unidades">${unidadesStock}</span>
                    <div class="row1">
                        <span class="codigo">${codigo}</span>
                        <span class="fabrica">${fabrica}</span>
                        <span class="unidad">${unidad}</span>
                    </div>
                    <div class="row2">
                        <span class="descripcion">${desc}</span>
                        <span class="stock">
                            <span class="cajas">${cajasStock} cj</span>
                            <span class="unidades">${unidadesStock} und</span>
                        </span>
                    </div>
                </div>`;
            });
            resultList.innerHTML = html;
            resultCount.textContent = items.length;

            if (selectedIndex !== -1 && selectedIndex < items.length) {
                actualizarCantidades(items[selectedIndex]);
            } else {
                limpiarCantidades();
            }

            document.querySelectorAll('.result-item').forEach(el => {
                el.addEventListener('click', function() {
                    const idx = parseInt(this.dataset.index);
                    if (idx === selectedIndex) return;
                    document.querySelectorAll('.result-item').forEach(e => e.classList.remove('selected'));
                    this.classList.add('selected');
                    selectedIndex = idx;
                    if (selectedIndex < filteredData.length) {
                        actualizarCantidades(filteredData[selectedIndex]);
                    }
                });
            });
        }

        // ============================================================
        // VENCIMIENTO (control de fechas)
        // ============================================================
        const MESES_CORTOS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

        function poblarSelectDia() {
            selDia.innerHTML = '';
            for (let d = 1; d <= 31; d++) {
                const opt = document.createElement('option');
                opt.value = d;
                opt.textContent = String(d).padStart(2, '0');
                selDia.appendChild(opt);
            }
        }

        function poblarSelectMes() {
            selMes.innerHTML = '';
            MESES_CORTOS.forEach((m, idx) => {
                const opt = document.createElement('option');
                opt.value = idx + 1;
                opt.textContent = `${String(idx + 1).padStart(2, '0')}-${m}`;
                selMes.appendChild(opt);
            });
        }

        function poblarYearTabs() {
            const base = new Date().getFullYear();
            yearTabs.innerHTML = '';
            for (let y = base; y <= base + 7; y++) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'year-tab' + (y === anioSeleccionado ? ' active' : '');
                btn.textContent = y;
                btn.dataset.year = y;
                btn.addEventListener('click', () => {
                    anioSeleccionado = y;
                    document.querySelectorAll('.year-tab').forEach(t => t.classList.remove('active'));
                    btn.classList.add('active');
                });
                yearTabs.appendChild(btn);
            }
        }

        function resetVencimientoAHoy() {
            const hoy = new Date();
            selDia.value = hoy.getDate();
            selMes.value = hoy.getMonth() + 1;
            anioSeleccionado = hoy.getFullYear();
            document.querySelectorAll('.year-tab').forEach(t => {
                t.classList.toggle('active', parseInt(t.dataset.year) === anioSeleccionado);
            });
        }

        function obtenerVencimientoSeleccionado() {
            const dia = String(selDia.value).padStart(2, '0');
            const mes = String(selMes.value).padStart(2, '0');
            return `${dia}-${mes}-${anioSeleccionado}`;
        }

        // Muestra en chips las fechas de vencimiento registradas para este
        // código de producto en los últimos 14 días (según la fecha/hora en
        // que se hizo el registro, no la fecha de vencimiento en sí). Cada
        // chip es un lote independiente y se puede eliminar por separado.
        function renderFechasRegistradas(codigo, unidadRef) {
            const LIMITE_DIAS = 14;
            const ahora = Date.now();
            const record = inventarioFisico.find(d => d.codigo === codigo);
            const lotes = (record && record.lotes) ? record.lotes : [];

            const recientes = lotes
                .map((l, idx) => ({ ...l, idx }))
                .filter(l => {
                    if (!l.fechaISO) return true; // lotes antiguos sin marca de tiempo: se muestran igual
                    const dias = (ahora - new Date(l.fechaISO).getTime()) / 86400000;
                    return dias <= LIMITE_DIAS;
                });

            if (recientes.length === 0) {
                vencChips.innerHTML = `<span class="venc-chip-empty">Sin registros recientes para este producto.</span>`;
                return;
            }

            vencChips.innerHTML = recientes.map(l => `
                <span class="venc-chip">
                    ${l.vencimiento || 'S/F'} · ${l.cantidad} ${unidadRef || ''}
                    <button type="button" class="venc-chip-del" data-codigo="${codigo}" data-idx="${l.idx}" title="Eliminar este lote">✕</button>
                </span>
            `).join('');

            document.querySelectorAll('.venc-chip-del').forEach(btn => {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    eliminarLote(this.dataset.codigo, parseInt(this.dataset.idx));
                });
            });
        }

        // Elimina un lote puntual (una cantidad con su fecha) de un producto
        // ya contado, y recalcula el total físico y la diferencia. Si era el
        // único lote, se elimina la fila completa del inventario físico.
        // También avisa al servidor para que el borrado se refleje en los
        // demás celulares/PC.
        function eliminarLote(codigo, idx) {
            const record = inventarioFisico.find(d => d.codigo === codigo);
            if (!record || !record.lotes) return;
            const [loteEliminado] = record.lotes.splice(idx, 1);
            if (record.lotes.length === 0) {
                inventarioFisico = inventarioFisico.filter(d => d.codigo !== codigo);
            } else {
                record.stockFisico = record.lotes.reduce((sum, l) => sum + l.cantidad, 0);
                record.diferencia = record.stockFisico - record.stockTeorico;
            }
            if (loteEliminado) eliminarLoteDelServidor(loteEliminado.id);
            saveInventario();
            renderInventario();
            if (selectedIndex !== -1 && selectedIndex < filteredData.length) {
                const item = filteredData[selectedIndex];
                if (getCodigo(item) === codigo) {
                    renderFechasRegistradas(codigo, getUnidadRef(item));
                }
            }
            showToast('Lote eliminado.', 'info');
        }

        // ============================================================
        // ACTUALIZAR CANTIDADES
        // ============================================================
        function actualizarCantidades(item) {
            let factor = getFactorFinal(item);
            currentFactor = factor;

            infoFactor.textContent = `Factor: ${factor}`;

            if (factor === 1) {
                cajasGroup.classList.add('hidden');
                txtCajas.disabled = true;
                txtCajas.value = '0';
            } else {
                cajasGroup.classList.remove('hidden');
                txtCajas.disabled = false;
                txtCajas.value = '0';
            }

            txtUnidades.value = '0';
            txtUnidades.disabled = false;

            const cantidad = getCantidad(item);
            const cajasStock = factor === 1 ? 0 : Math.floor(cantidad / factor);
            const unidadesStock = factor === 1 ? cantidad : cantidad % factor;
            cajasCount.textContent = cajasStock;
            unidadesCount.textContent = unidadesStock;

            vencBlock.classList.remove('hidden');
            resetVencimientoAHoy();
            renderFechasRegistradas(getCodigo(item), getUnidadRef(item));

            // Datos de la tarjeta de producto seleccionado (modo móvil)
            document.body.classList.add('modo-seleccion');
            paDescripcion.textContent = getDescripcion(item);
            const codFab = getCodigoFabrica(item);
            paCodigo.textContent = codFab ? `Cód: ${getCodigo(item)} | Cód. Fábrica: ${codFab}` : `Cód: ${getCodigo(item)}`;
            paUnidad.textContent = getUnidadRef(item) || '-';
            paFactor.textContent = factor === 1 ? 'Unidad suelta' : `${factor} und/caja`;
            paStock.textContent = factor === 1
                ? `${unidadesStock} unidades`
                : `${cajasStock} cajas, ${unidadesStock} unidades`;
            paTotalUnidad.textContent = getUnidadRef(item) || '';
            actualizarTotalCalculado();
        }

        function limpiarCantidades() {
            cajasGroup.classList.remove('hidden');
            txtCajas.value = '0';
            txtUnidades.value = '0';
            currentFactor = 1;
            infoFactor.textContent = 'Factor: 1';
            txtCajas.disabled = true;
            txtUnidades.disabled = false;
            cajasCount.textContent = '0';
            unidadesCount.textContent = '0';
            vencBlock.classList.add('hidden');
            document.body.classList.remove('modo-seleccion');
            paTotalValor.textContent = '0';
        }

        // Regresa de la tarjeta de producto seleccionado a la lista de
        // resultados, sin perder el término de búsqueda ni la lista ya
        // cargada, para poder elegir el siguiente producto rápido.
        function volverABuscar() {
            selectedIndex = -1;
            document.querySelectorAll('.result-item').forEach(e => e.classList.remove('selected'));
            limpiarCantidades();
        }

        // Calcula en vivo cuánto se va a registrar (cajas*factor + unidades
        // sueltas) para mostrarlo en la tarjeta de producto seleccionado.
        function actualizarTotalCalculado() {
            const cajas = parseInt(txtCajas.value) || 0;
            const unidades = parseInt(txtUnidades.value) || 0;
            const total = (cajas * currentFactor) + unidades;
            paTotalValor.textContent = total;
            actualizarAvisoConversion(cajas, unidades);
        }

        // Si el producto tiene factor de empaque (viene en cajas) y el
        // usuario está escribiendo la cantidad como unidades sueltas (por
        // ejemplo, contó 50 unidades sueltas de un producto que se
        // empaca de a 12), se muestra un aviso en vivo de a cuántas cajas
        // + unidades sueltas equivale, sin tocar todavía lo que el
        // usuario está escribiendo (para no mover el cursor mientras
        // tipea). La conversión real se aplica al salir del campo, con
        // normalizarUnidadesACajas().
        function actualizarAvisoConversion(cajas, unidades) {
            if (currentFactor > 1 && unidades >= currentFactor) {
                const cajasEquivalentes = cajas + Math.floor(unidades / currentFactor);
                const unidadesRestantes = unidades % currentFactor;
                conversionHint.textContent = `🔄 Equivale a ${cajasEquivalentes} caja${cajasEquivalentes === 1 ? '' : 's'} + ${unidadesRestantes} unidad${unidadesRestantes === 1 ? '' : 'es'} suelta${unidadesRestantes === 1 ? '' : 's'}`;
                conversionHint.classList.add('visible');
            } else {
                conversionHint.classList.remove('visible');
            }
        }

        // Aplica de verdad la conversión: mueve el sobrante de "Unidades"
        // hacia "Cajas" según el factor de empaque del producto. Se llama
        // al salir del campo de unidades y también justo antes de
        // guardar/agregar, así el usuario puede escribir todo en
        // unidades sueltas (como ya venía contando) y la app lo reparte
        // sola en cajas + unidades cuando corresponde.
        function normalizarUnidadesACajas() {
            if (currentFactor <= 1) return;
            const cajas = parseInt(txtCajas.value) || 0;
            const unidades = parseInt(txtUnidades.value) || 0;
            if (unidades >= currentFactor) {
                txtCajas.value = cajas + Math.floor(unidades / currentFactor);
                txtUnidades.value = unidades % currentFactor;
            }
            conversionHint.classList.remove('visible');
            actualizarTotalCalculado();
        }

        // ============================================================
        // PEDIDO (modo secundario + mismo buscador / catálogo existencias)
        // ============================================================
        let modoPedido = false;

        function activarModoPedido() {
            modoPedido = true;
            document.body.classList.add('modo-pedido-activo');
            const banner = document.getElementById('modoPedidoBanner');
            if (banner) banner.classList.remove('hidden');
            setCardExpandida('pedido', true);
            // Mismo buscador: enfocar y mostrar sección de búsqueda
            document.body.classList.remove('modo-seleccion');
            const searchSection = document.getElementById('searchSection');
            if (searchSection) {
                searchSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            if (searchInput) {
                searchInput.focus();
                searchInput.select();
            }
            showToast('Modo pedido activo. Busca por código o nombre del catálogo.', 'info');
        }

        function salirModoPedido() {
            modoPedido = false;
            document.body.classList.remove('modo-pedido-activo');
            const banner = document.getElementById('modoPedidoBanner');
            if (banner) banner.classList.add('hidden');
            showToast('Volviste al modo inventario.', 'info');
        }

        function agregarProducto() {
            if (selectedIndex === -1 || selectedIndex >= filteredData.length) {
                showToast('Seleccione un producto de la lista.', 'error');
                return;
            }
            normalizarUnidadesACajas();
            const item = filteredData[selectedIndex];
            const codigo = getCodigo(item);
            const codigoFabrica = getCodigoFabrica(item);
            const descripcion = getDescripcion(item);
            const unidad = getUnidadRef(item);
            const linea = getLinea(item) || 'SIN LÍNEA';
            const factor = currentFactor;
            const esSuelta = factor === 1;

            const stockTotal = getCantidad(item);
            const stockCajas = esSuelta ? 0 : Math.floor(stockTotal / factor);
            const stockUnidades = esSuelta ? stockTotal : stockTotal % factor;

            let cajasPedido = parseInt(txtCajas.value) || 0;
            let unidadesPedido = parseInt(txtUnidades.value) || 0;
            if (cajasPedido === 0 && unidadesPedido === 0) {
                showToast('Ingrese una cantidad (cajas o unidades).', 'error');
                return;
            }

            let totalPedido = 0;
            if (esSuelta) {
                totalPedido = cajasPedido + unidadesPedido;
            } else {
                totalPedido = (cajasPedido * factor) + unidadesPedido;
            }

            if (totalPedido === 0) {
                showToast('Cantidad cero, no se agregará.', 'error');
                return;
            }

            if (totalPedido > stockTotal) {
                showToast(`Stock insuficiente. Disponible: ${stockCajas} cajas y ${stockUnidades} unidades sueltas.`, 'error');
                return;
            }

            let existing = pedido.find(p => p.codigo === codigo);
            if (existing) {
                let nuevasCajas = existing.cajas;
                let nuevasUnidades = existing.unidades;
                if (esSuelta) {
                    let total = (nuevasCajas + nuevasUnidades) + (cajasPedido + unidadesPedido);
                    nuevasCajas = 0;
                    nuevasUnidades = total;
                } else {
                    let total = (nuevasCajas * factor) + nuevasUnidades + (cajasPedido * factor) + unidadesPedido;
                    nuevasCajas = Math.floor(total / factor);
                    nuevasUnidades = total % factor;
                }
                let totalActualizado = (nuevasCajas * factor) + nuevasUnidades;
                if (totalActualizado > stockTotal) {
                    showToast(`No puedes agregar más de lo disponible. Stock: ${stockCajas} cajas y ${stockUnidades} unidades.`, 'error');
                    return;
                }
                existing.cajas = nuevasCajas;
                existing.unidades = nuevasUnidades;
            } else {
                let newCajas = 0, newUnidades = 0;
                if (esSuelta) {
                    newCajas = 0;
                    newUnidades = totalPedido;
                } else {
                    newCajas = Math.floor(totalPedido / factor);
                    newUnidades = totalPedido % factor;
                }
                pedido.push({
                    codigo: codigo,
                    codigoFabrica: codigoFabrica,
                    descripcion: descripcion,
                    unidad: unidad,
                    linea: linea,
                    cajas: newCajas,
                    unidades: newUnidades,
                    factor: factor,
                    esSuelta: esSuelta
                });
            }

            txtCajas.value = '0';
            txtUnidades.value = '0';
            renderPedido();
            savePedido();
            if (selectedIndex < filteredData.length) {
                actualizarCantidades(filteredData[selectedIndex]);
            }
            showToast(`✅ ${totalPedido} unidades agregadas al pedido.`, 'success');
        }

        function eliminarDelPedido(codigo) {
            pedido = pedido.filter(p => p.codigo !== codigo);
            renderPedido();
            savePedido();
        }

        function limpiarPedido() {
            if (pedido.length === 0) return;
            confirmarAccion('¿Eliminar todos los productos del pedido?').then(ok => {
                if (!ok) return;
                pedido = [];
                renderPedido();
                savePedido();
                showToast('Pedido vaciado.', 'info');
            });
        }

        function renderPedido() {
            if (pedido.length === 0) {
                pedidoBody.innerHTML = `<tr><td colspan="8" class="empty-message">No hay productos en el pedido.</td></tr>`;
                pedidoMobileList.innerHTML = `<div class="empty-message">No hay productos en el pedido.</div>`;
                pedidoFoot.style.display = 'none';
                totalCajasPedido.textContent = '0';
                totalUnidadesPedido.textContent = '0';
                pedidoCount.textContent = '0 productos';
                collapseCardEnMovil('pedido');
                return;
            }

            let html = '';
            let mobileHtml = '';
            let totalCajas = 0, totalUnidades = 0;
            pedido.forEach((p, idx) => {
                totalCajas += p.cajas;
                totalUnidades += p.unidades;
                html += `<tr>
                    <td>${idx + 1}</td>
                    <td class="codigo-cell">${p.codigo}</td>
                    <td style="color:var(--text-muted);">${p.codigoFabrica}</td>
                    <td style="color:var(--text-secondary);">${p.descripcion}</td>
                    <td style="color:var(--text-muted);">${p.unidad}</td>
                    <td class="cantidad-cell">${p.cajas}</td>
                    <td class="cantidad-cell">${p.unidades}</td>
                    <td class="acciones-cell"><button class="eliminar-fila" data-codigo="${p.codigo}">✕</button></td>
                </tr>`;
                mobileHtml += `<div class="mi-card">
                    <div class="mi-card-head">
                        <div class="mi-card-idcol">
                            <div class="mi-card-idrow">
                                <span class="mi-card-num">#${idx + 1}</span>
                                <span class="mi-card-codigo">${p.codigo}</span>
                                ${p.codigoFabrica ? `<span class="mi-card-fabrica">(${p.codigoFabrica})</span>` : ''}
                            </div>
                            <div class="mi-card-desc">${p.descripcion}</div>
                        </div>
                        <button class="mi-card-del eliminar-fila-movil" data-codigo="${p.codigo}" title="Eliminar del pedido">🗑️</button>
                    </div>
                    <div class="mi-card-stats">
                        <div><span class="mi-stat-label">Unidad</span><span class="mi-stat-value">${p.unidad}</span></div>
                        <div><span class="mi-stat-label">Cajas</span><span class="mi-stat-value">${p.cajas}</span></div>
                        <div><span class="mi-stat-label">Unidades</span><span class="mi-stat-value">${p.unidades}</span></div>
                    </div>
                </div>`;
            });

            pedidoBody.innerHTML = html;
            pedidoMobileList.innerHTML = mobileHtml;
            pedidoFoot.style.display = 'table-row-group';
            totalCajasFoot.textContent = totalCajas;
            totalUnidadesFoot.textContent = totalUnidades;
            totalCajasPedido.textContent = totalCajas;
            totalUnidadesPedido.textContent = totalUnidades;
            pedidoCount.textContent = `${pedido.length} productos`;
            expandCardSiHaceFalta('pedido');

            document.querySelectorAll('.eliminar-fila, .eliminar-fila-movil').forEach(btn => {
                btn.addEventListener('click', function() {
                    const codigo = this.dataset.codigo;
                    eliminarDelPedido(codigo);
                });
            });
        }

        // ============================================================
        // PERSISTENCIA PEDIDO
        // ============================================================
        function savePedido() {
            try {
                localStorage.setItem('pedido_actual', JSON.stringify(pedido));
            } catch(e) {
                showToast('⚠️ No se pudo guardar el pedido en este dispositivo (almacenamiento lleno o bloqueado).', 'error');
            }
        }
        function loadPedido() {
            try {
                const raw = localStorage.getItem('pedido_actual');
                if (raw) { pedido = JSON.parse(raw); renderPedido(); }
            } catch(e) { pedido = []; }
        }

        // ============================================================
        // EXPORTAR PEDIDO
        // ============================================================
        function agruparPorLinea(items, getLineaItem) {
            const grupos = {};
            items.forEach(item => {
                const linea = getLineaItem(item) || 'SIN LÍNEA';
                if (!grupos[linea]) grupos[linea] = [];
                grupos[linea].push(item);
            });
            return Object.keys(grupos).sort((a, b) => a.localeCompare(b)).map(linea => ({
                linea: linea,
                items: grupos[linea]
            }));
        }

        function exportarPedido() {
            if (pedido.length === 0) {
                showToast('No hay productos en el pedido.', 'error');
                return;
            }

            const grupos = agruparPorLinea(pedido, p => p.linea);
            const filas = [
                ['#', 'Código', 'Cód. Fábrica', 'Descripción', 'Unidad', 'Línea', 'Cajas', 'Unidades', 'Factor', 'Total (und)']
            ];

            grupos.forEach(grupo => {
                filas.push([`LÍNEA: ${grupo.linea}`]);
                let contador = 1;
                let subCajas = 0, subUnidades = 0;
                grupo.items.forEach(p => {
                    const total = (p.cajas * p.factor) + p.unidades;
                    filas.push([contador++, p.codigo, p.codigoFabrica, p.descripcion, p.unidad, p.linea, p.cajas, p.unidades, p.factor, total]);
                    subCajas += p.cajas;
                    subUnidades += p.unidades;
                });
                filas.push(['', '', '', '', '', 'Subtotal línea', subCajas, subUnidades, '', '']);
                filas.push([]);
            });

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(filas);
            ws['!cols'] = [{wch:6},{wch:10},{wch:14},{wch:42},{wch:10},{wch:24},{wch:8},{wch:10},{wch:8},{wch:12}];
            XLSX.utils.book_append_sheet(wb, ws, 'Pedido');
            const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([wbout], { type: 'application/octet-stream' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `pedido_${new Date().toISOString().slice(0,10)}.xlsx`;
            link.click();
            URL.revokeObjectURL(link.href);
            showToast('📥 Pedido exportado a Excel.', 'success');
        }

        // ============================================================
        // GUARDAR PEDIDO EN DRIVE
        // ============================================================
        function guardarPedidoEnDrive() {
            if (pedido.length === 0) {
                showToast('No hay productos en el pedido.', 'error');
                return;
            }
            showToast('Use el botón Excel para descargar el pedido. Drive ya no es necesario con Supabase.', 'info');
        }

        // Avisa al servidor que un lote puntual (por su id) fue eliminado,
        // para que desaparezca también de la hoja "ConteoVivo" y, con eso,
        // de los demás celulares/PC en su próxima sincronización. Antes el
        // borrado solo pasaba en localStorage de este dispositivo, así que
        // el registro "eliminado" seguía existiendo en el servidor y
        // reaparecía en los demás.
        function eliminarLoteDelServidor(id) {
            if (!id) return;
            supabaseClient.from('lotes_conteo').delete().eq('id', id)
                .then(({ error }) => { if (error) console.warn('No se pudo borrar lote:', error); });
        }

        // ============================================================
        // CONTEO EN VIVO COMPARTIDO (varios celulares al mismo tiempo)
        // ============================================================
        // Envía un solo lote recién contado a la hoja "ConteoVivo" para que
        // los demás celulares lo vean en su próxima sincronización. No hace
        // falta leer la respuesta: si la red falla, el conteo local no se
        // pierde (queda guardado igual) y se puede reintentar más tarde.
        function normalizarVencimiento(v) {
            if (v === null || v === undefined) return '';
            return String(v).trim().toLowerCase();
        }

        // Mismo producto + misma fecha de vencimiento = mismo lote (se suma, no se duplica)
        function idLotePorProductoYVencimiento(codigo, vencimiento) {
            const venc = normalizarVencimiento(vencimiento) || 'sin_vencimiento';
            return String(codigo).trim() + '__' + venc.replace(/\s+/g, '_');
        }

        function sincronizarLoteAlServidor(record, lote) {
            const factor = record.factor || 1;
            const cajasLote = factor > 1 ? Math.floor(lote.cantidad / factor) : 0;
            const unidadesLote = factor > 1 ? (lote.cantidad % factor) : lote.cantidad;
            supabaseClient.from('lotes_conteo').upsert({
                id: lote.id,
                codigo: record.codigo,
                descripcion: record.descripcion,
                linea: record.linea || 'SIN LÍNEA',
                cantidad: lote.cantidad,
                cajas: cajasLote,
                unidades: unidadesLote,
                vencimiento: lote.vencimiento || null,
                fecha: lote.fecha || null,
                usuario: lote.usuario || usuarioActual || '',
                device_id: deviceId
            }).then(({ error }) => { if (error) console.warn('No se pudo subir lote:', error); });
        }

        // Une lotes del mismo producto con la misma fecha de vencimiento sumando cantidades.
        // Así varios dispositivos (o el mismo) no generan filas duplicadas en el reporte.
        function consolidarLotesDelRegistro(record) {
            if (!record || !Array.isArray(record.lotes)) return;
            const mapa = new Map();
            const idsAEliminar = [];
            record.lotes.forEach(l => {
                const key = normalizarVencimiento(l.vencimiento);
                const idCanonico = idLotePorProductoYVencimiento(record.codigo, l.vencimiento);
                if (!mapa.has(key)) {
                    const copia = Object.assign({}, l);
                    copia.id = idCanonico;
                    copia.cantidad = Number(copia.cantidad) || 0;
                    mapa.set(key, copia);
                    if (l.id && String(l.id) !== idCanonico) {
                        idsAEliminar.push(String(l.id));
                    }
                } else {
                    const acc = mapa.get(key);
                    acc.cantidad = (Number(acc.cantidad) || 0) + (Number(l.cantidad) || 0);
                    if (l.usuario && !acc.usuario) acc.usuario = l.usuario;
                    if (l.fecha) acc.fecha = l.fecha;
                    if (l.id && String(l.id) !== acc.id) {
                        idsAEliminar.push(String(l.id));
                    }
                }
            });
            record.lotes = Array.from(mapa.values());
            record.stockFisico = record.lotes.reduce((sum, l) => sum + (Number(l.cantidad) || 0), 0);
            record.diferencia = record.stockFisico - (Number(record.stockTeorico) || 0);
            // Limpia ids viejos duplicados en la nube (best-effort)
            idsAEliminar.forEach(id => {
                if (id) eliminarLoteDelServidor(id);
            });
        }

        // Combina un registro recibido del servidor con el inventario local.
        // Mismo código + misma fecha de vencimiento → se SUMA, no se duplica.
        function fusionarRegistroRemoto(r) {
            let record = inventarioFisico.find(d => d.codigo === r.codigo);
            if (!record) {
                record = {
                    codigo: r.codigo,
                    descripcion: r.descripcion,
                    linea: r.linea || 'SIN LÍNEA',
                    stockTeorico: 0,
                    stockFisico: 0,
                    diferencia: 0,
                    lotes: [],
                    fecha: r.fecha,
                    fechaISO: new Date().toISOString()
                };
                const item = currentData.find(it => getCodigo(it) === r.codigo);
                if (item) {
                    record.stockTeorico = getCantidad(item);
                    record.factor = getFactorFinal(item);
                }
                inventarioFisico.push(record);
            }

            const idCanonico = r.id || idLotePorProductoYVencimiento(r.codigo, r.vencimiento);
            const vencKey = normalizarVencimiento(r.vencimiento);
            let lote = record.lotes.find(l =>
                l.id === idCanonico || normalizarVencimiento(l.vencimiento) === vencKey
            );

            const cantidadRemota = Number(r.cantidad) || 0;
            if (!lote) {
                record.lotes.push({
                    id: idCanonico,
                    vencimiento: r.vencimiento,
                    cantidad: cantidadRemota,
                    fecha: r.fecha,
                    fechaISO: new Date().toISOString(),
                    usuario: r.usuario || ''
                });
            } else {
                // Si llega el mismo id, tomamos la cantidad del servidor (ya consolidada).
                // Si es otro id pero misma fecha, sumamos solo si aún no estaba ese id.
                if (lote.id === r.id || lote.id === idCanonico) {
                    lote.cantidad = cantidadRemota;
                } else {
                    // Evitar doble suma en cada poll: guardamos ids fusionados
                    if (!lote._idsFusionados) lote._idsFusionados = new Set([String(lote.id)]);
                    const rid = String(r.id || idCanonico);
                    if (!lote._idsFusionados.has(rid)) {
                        lote.cantidad = (Number(lote.cantidad) || 0) + cantidadRemota;
                        lote._idsFusionados.add(rid);
                    } else {
                        // Ya integrado; si el servidor trae total canónico con id fijo, preferir mayor
                        lote.cantidad = Math.max(Number(lote.cantidad) || 0, cantidadRemota);
                    }
                }
                lote.id = idCanonico;
                lote.vencimiento = r.vencimiento;
                if (r.usuario) lote.usuario = r.usuario;
                if (r.fecha) lote.fecha = r.fecha;
            }

            consolidarLotesDelRegistro(record);
        }

        // El servidor (obtenerLotes en el Apps Script) manda SIEMPRE la
        // hoja "ConteoVivo" completa, no solo lo nuevo. Aprovechamos eso
        // para borrar localmente cualquier lote que ya no esté en esa
        // lista (por ejemplo, porque otro celular lo eliminó): si un lote
        // tiene id (ya se sincronizó alguna vez) y ese id ya no aparece en
        // la lista del servidor, se quita de aquí también. Los lotes sin
        // id (registros viejos, previos a esta sincronización) se dejan
        // intactos porque nunca llegaron a viajar al servidor.
        function quitarLotesBorradosEnServidor(registros) {
            const idsServidor = new Set(registros.map(r => String(r.id)));
            let huboCambios = false;
            inventarioFisico = inventarioFisico.filter(record => {
                const lotesAntes = record.lotes.length;
                record.lotes = record.lotes.filter(l => !l.id || idsServidor.has(String(l.id)));
                if (record.lotes.length !== lotesAntes) huboCambios = true;
                if (record.lotes.length === 0) return false;
                record.stockFisico = record.lotes.reduce((sum, l) => sum + l.cantidad, 0);
                record.diferencia = record.stockFisico - record.stockTeorico;
                return true;
            });
            return huboCambios;
        }

        // Consulta la hoja "ConteoVivo" y trae lo que hayan contado otros
        // celulares desde la última vez. Se llama sola cada 10 segundos.
        async function sincronizarDesdeServidor() {
            if (sincronizando) return;
            sincronizando = true;
            try {
                const { data, error } = await supabaseClient
                    .from('lotes_conteo').select('*').order('creado_en', { ascending: true });
                if (error) throw error;
                const registros = (data || []).map(r => ({
                    id: r.id, codigo: r.codigo, descripcion: r.descripcion, linea: r.linea,
                    cantidad: r.cantidad, vencimiento: r.vencimiento, fecha: r.fecha, usuario: r.usuario || ''
                }));
                registros.forEach(fusionarRegistroRemoto);
                inventarioFisico.forEach(consolidarLotesDelRegistro);
                const huboBorrados = quitarLotesBorradosEnServidor(registros);
                if (registros.length === 0 && !huboBorrados && inventarioFisico.length === 0) return;
                saveInventario();
                renderInventario();
            } catch (e) { /* sin red */ }
            finally { sincronizando = false; }
        }

        // ============================================================
        // REGISTRAR INVENTARIO FÍSICO
        // ============================================================
        // Muestra una cantidad total (siempre guardada en unidades sueltas,
        // aunque el usuario haya escrito todo en el campo "Unidades") como
        // "cajas + unidades sueltas", usando el factor de empaque del
        // producto. Así, aunque se conteo todo suelto, la tabla de
        // Inventario Físico lo agrupa igual que si se hubiera ingresado en
        // cajas.
        function formatCajasUnidades(cantidad, factor) {
            const total = Number(cantidad) || 0;
            if (!factor || factor <= 1) return `${total} und`;
            const cajas = Math.floor(total / factor);
            const unidades = total % factor;
            if (cajas === 0) return `${unidades} und`;
            if (unidades === 0) return `${cajas} cj`;
            return `${cajas} cj + ${unidades} und`;
        }

        // Devuelve el factor de empaque a usar para un registro de
        // inventario físico: el que se guardó al registrarlo, o si no
        // existe (registros antiguos o sincronizados de otro celular),
        // lo busca en los datos del producto.
        function factorDeRegistro(d) {
            if (typeof d.factor === 'number' && d.factor > 0) return d.factor;
            const item = currentData.find(it => getCodigo(it) === d.codigo);
            return item ? getFactorFinal(item) : 1;
        }

        // Lista de usuarios distintos que contaron este producto (puede
        // venir de más de un celular). Sirve para detectar en la tabla si
        // el mismo producto fue contado dos veces por error, desde
        // dispositivos con usuarios distintos.
        function usuariosDeRegistro(d) {
            const lotes = d.lotes || [];
            return [...new Set(lotes.map(l => l.usuario).filter(u => u))];
        }

        function registrarFisico() {
            if (selectedIndex === -1 || selectedIndex >= filteredData.length) {
                showToast('Seleccione un producto de la lista.', 'error');
                return;
            }
            normalizarUnidadesACajas();
            const item = filteredData[selectedIndex];
            const codigo = getCodigo(item);
            const descripcion = getDescripcion(item);
            const linea = getLinea(item) || 'SIN LÍNEA';
            const stockTeorico = getCantidad(item);
            const factor = currentFactor;
            const esSuelta = factor === 1;

            let cajas = parseInt(txtCajas.value) || 0;
            let unidades = parseInt(txtUnidades.value) || 0;

            if (esSuelta) {
                unidades += cajas;
                cajas = 0;
            }

            // Cantidad de este lote (no el total del producto): se suma a lo
            // que ya se hubiera registrado antes para el mismo código, cada
            // porción con su propia fecha de vencimiento.
            const cantidadLote = (cajas * factor) + unidades;

            if (cantidadLote === 0) {
                showToast('Ingrese una cantidad mayor que cero.', 'error');
                return;
            }

            const ahora = new Date();
            const fechaStr = ahora.toLocaleDateString() + ' ' + ahora.toLocaleTimeString();
            const vencimiento = obtenerVencimientoSeleccionado();

            // Busca si el producto ya tiene un registro (de otro lote/fecha) y
            // acumula ahí en vez de crear una fila aparte.
            let record = inventarioFisico.find(d => d.codigo === codigo);
            if (!record) {
                record = {
                    codigo: codigo,
                    descripcion: descripcion,
                    linea: linea,
                    stockTeorico: stockTeorico,
                    stockFisico: 0,
                    diferencia: 0,
                    factor: factor,
                    lotes: [],
                    fecha: fechaStr,
                    fechaISO: ahora.toISOString()
                };
                inventarioFisico.push(record);
            }
            record.factor = factor;

            const idCanonico = idLotePorProductoYVencimiento(codigo, vencimiento);
            const vencKey = normalizarVencimiento(vencimiento);
            let loteExistente = record.lotes.find(l =>
                l.id === idCanonico || normalizarVencimiento(l.vencimiento) === vencKey
            );

            let loteParaSync;
            if (loteExistente) {
                // Mismo producto + misma fecha → SUMAR, no crear otra fila
                loteExistente.cantidad = (Number(loteExistente.cantidad) || 0) + cantidadLote;
                loteExistente.id = idCanonico;
                loteExistente.fecha = fechaStr;
                loteExistente.fechaISO = ahora.toISOString();
                loteExistente.usuario = usuarioActual || loteExistente.usuario || '';
                loteExistente.vencimiento = vencimiento;
                loteParaSync = loteExistente;
            } else {
                loteParaSync = {
                    id: idCanonico,
                    vencimiento: vencimiento,
                    cantidad: cantidadLote,
                    fecha: fechaStr,
                    fechaISO: ahora.toISOString(),
                    usuario: usuarioActual || ''
                };
                record.lotes.push(loteParaSync);
            }

            record.stockTeorico = stockTeorico;
            record.stockFisico = record.lotes.reduce((sum, l) => sum + (Number(l.cantidad) || 0), 0);
            record.diferencia = record.stockFisico - record.stockTeorico;
            record.fecha = fechaStr;
            record.fechaISO = ahora.toISOString();

            // Comparte el total consolidado con los demás dispositivos
            sincronizarLoteAlServidor(record, loteParaSync);

            saveInventario();
            renderInventario();
            txtCajas.value = '0';
            txtUnidades.value = '0';
            const totalLotes = record.lotes.length;
            const msgLote = totalLotes > 1 ? ` (${totalLotes} fechas, total físico ${record.stockFisico})` : ` (total físico ${record.stockFisico})`;
            showToast(`✅ +${cantidadLote} (vence ${vencimiento || 's/f'})${msgLote}. Dif: ${record.diferencia}`, 'success');
            // Vuelve a la lista de resultados para seguir contando el
            // siguiente producto, en vez de quedarse en el mismo.
            volverABuscar();
        }

        // ============================================================
        // PERSISTENCIA INVENTARIO
        // ============================================================
        const INV_KEY = 'buscador_inventario_fisico';

        function saveInventario() {
            try {
                localStorage.setItem(INV_KEY, JSON.stringify(inventarioFisico));
            } catch(e) {
                showToast('⚠️ No se pudo guardar el inventario físico en este dispositivo (almacenamiento lleno o bloqueado).', 'error');
            }
        }
        function loadInventario() {
            try {
                const raw = localStorage.getItem(INV_KEY);
                if (raw) {
                    inventarioFisico = JSON.parse(raw);
                    // Migración: registros guardados antes de tener "lotes" (una
                    // sola fecha de vencimiento por fila) se convierten al nuevo
                    // formato de lista de lotes para que sigan funcionando igual.
                    inventarioFisico.forEach(d => {
                        if (!d.lotes) {
                            d.lotes = [{
                                vencimiento: d.vencimiento || null,
                                cantidad: d.stockFisico,
                                fecha: d.fecha,
                                fechaISO: d.fechaISO || null
                            }];
                        }
                    });
                }
            } catch(e) { inventarioFisico = []; }
        }

        // ============================================================
        // RENDER INVENTARIO
        // ============================================================
        function renderInventario() {
            if (inventarioFisico.length === 0) {
                diffBody.innerHTML = `<tr><td colspan="10" class="empty-message">No hay productos contados aún.</td></tr>`;
                diffMobileList.innerHTML = `<div class="empty-message">No hay productos contados aún.</div>`;
                diffFoot.style.display = 'none';
                diffResumen.style.display = 'none';
                diffCount.textContent = '0 registros';
                resContados.textContent = '0';
                collapseCardEnMovil('diff');
                return;
            }

            let html = '';
            let mobileHtml = '';
            let totalTeorico = 0, totalFisico = 0, totalDiff = 0;
            inventarioFisico.forEach((d, idx) => {
                totalTeorico += d.stockTeorico;
                totalFisico += d.stockFisico;
                totalDiff += d.diferencia;
                const claseDiff = d.diferencia >= 0 ? 'diff-positivo' : 'diff-negativo';
                const lotes = d.lotes || [];
                const vencTexto = lotes.length > 1
                    ? `${lotes.length} lotes`
                    : (lotes[0] ? lotes[0].vencimiento : (d.vencimiento || '-'));
                const vencTitulo = lotes.map(l => `${l.vencimiento || 'S/F'}: ${l.cantidad}`).join(' | ');
                // Aunque el conteo se haya ingresado todo en el campo de
                // unidades sueltas, aquí se agrupa en cajas + unidades
                // sueltas según el factor de empaque del producto.
                const factorReg = factorDeRegistro(d);
                const teoricoTexto = formatCajasUnidades(d.stockTeorico, factorReg);
                const fisicoTexto = formatCajasUnidades(d.stockFisico, factorReg);
                // Si el mismo producto tiene lotes de más de un usuario, es
                // probable que dos celulares lo hayan contado por separado
                // (duplicado). Se marca con ⚠️ para que se note a simple
                // vista, con el detalle de cada lote y su usuario al pasar
                // el cursor (o al mantener presionado en el celular).
                const usuarios = usuariosDeRegistro(d);
                const usuarioTexto = usuarios.length ? usuarios.join(', ') : '-';
                const usuarioDuplicado = usuarios.length > 1;
                const usuarioTitulo = lotes.map(l => `${l.usuario || 'S/U'}: ${l.cantidad} (${l.fecha || ''})`).join(' | ');
                const usuarioColor = usuarioDuplicado ? 'var(--danger)' : 'var(--text-muted)';
                const usuarioCelda = `${usuarioDuplicado ? '⚠️ ' : ''}${usuarioTexto}`;
                html += `<tr>
                    <td>${idx + 1}</td>
                    <td class="codigo-cell">${d.codigo}</td>
                    <td style="color:var(--text-secondary);">${d.descripcion}</td>
                    <td style="color:var(--heading-color);" title="${d.stockTeorico} und">${teoricoTexto}</td>
                    <td style="color:var(--heading-color);" title="${d.stockFisico} und">${fisicoTexto}</td>
                    <td class="${claseDiff}">${d.diferencia}</td>
                    <td style="color:var(--heading-color);" title="${vencTitulo}">${vencTexto}</td>
                    <td style="color:var(--text-muted);">${d.fecha}</td>
                    <td style="color:${usuarioColor}; font-weight:${usuarioDuplicado ? '700' : '400'};" title="${usuarioTitulo}">${usuarioCelda}</td>
                    <td class="acciones-cell"><button class="eliminar-diff" data-index="${idx}">✕</button></td>
                </tr>`;
                mobileHtml += `<div class="mi-card">
                    <div class="mi-card-head">
                        <div class="mi-card-idcol">
                            <div class="mi-card-idrow">
                                <span class="mi-card-num">#${idx + 1}</span>
                                <span class="mi-card-codigo">${d.codigo}</span>
                            </div>
                            <div class="mi-card-desc">${d.descripcion}</div>
                        </div>
                        <button class="mi-card-del eliminar-diff-movil" data-index="${idx}" title="Eliminar registro">🗑️</button>
                    </div>
                    <div class="mi-card-stats">
                        <div><span class="mi-stat-label">Teórico</span><span class="mi-stat-value">${teoricoTexto}</span></div>
                        <div><span class="mi-stat-label">Físico</span><span class="mi-stat-value">${fisicoTexto}</span></div>
                        <div><span class="mi-stat-label">Diferencia</span><span class="mi-stat-value ${claseDiff}">${d.diferencia}</span></div>
                    </div>
                    <div class="mi-card-meta">
                        <span title="${vencTitulo}">📅 ${vencTexto}</span>
                        <span>🕒 ${d.fecha}</span>
                        <span style="color:${usuarioColor}; font-weight:${usuarioDuplicado ? '700' : '400'};" title="${usuarioTitulo}">👤 ${usuarioCelda}</span>
                    </div>
                </div>`;
            });

            diffBody.innerHTML = html;
            diffMobileList.innerHTML = mobileHtml;
            diffFoot.style.display = 'table-row-group';
            diffTotalTeorico.textContent = totalTeorico;
            diffTotalFisico.textContent = totalFisico;
            diffTotalDiferencia.textContent = totalDiff;

            diffResumen.style.display = 'flex';
            resTeorico.textContent = totalTeorico;
            resFisico.textContent = totalFisico;
            resDiferencia.textContent = totalDiff;
            resContados.textContent = inventarioFisico.length;

            diffCount.textContent = `${inventarioFisico.length} registros`;
            expandCardSiHaceFalta('diff');

            document.querySelectorAll('.eliminar-diff, .eliminar-diff-movil').forEach(btn => {
                btn.addEventListener('click', function() {
                    const idx = parseInt(this.dataset.index);
                    const registro = inventarioFisico[idx];
                    if (!registro) return;
                    confirmarAccion(`¿Eliminar el registro de "${registro.descripcion}"? Esto borra todos sus lotes contados.`).then(ok => {
                        if (!ok) return;
                        (registro.lotes || []).forEach(l => eliminarLoteDelServidor(l.id));
                        inventarioFisico.splice(idx, 1);
                        saveInventario();
                        renderInventario();
                    });
                });
            });
        }

        // ============================================================
        // EXPORTAR INVENTARIO
        // ============================================================
        
        async function enviarInventarioCompleto() {
            if (!inventarioFisico || inventarioFisico.length === 0) {
                showToast('No hay conteo físico para enviar.', 'error');
                return;
            }
            const ok = await confirmarAccion(
                '¿Enviar el inventario físico revisado a la nube?\nSe subirán todos los lotes contados para que el administrador los vea y descargue.',
                'Enviar',
                'primary'
            );
            if (!ok) return;

            const btn = document.getElementById('enviarInventarioBtn');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-label"> Enviando...</span>';
            }
            showToast('⏳ Enviando inventario a la nube...', 'info');

            try {
                const filas = [];
                inventarioFisico.forEach(record => {
                    const factor = record.factor || 1;
                    (record.lotes || []).forEach(lote => {
                        const cajasLote = factor > 1 ? Math.floor(lote.cantidad / factor) : 0;
                        const unidadesLote = factor > 1 ? (lote.cantidad % factor) : lote.cantidad;
                        filas.push({
                            id: lote.id,
                            codigo: record.codigo,
                            descripcion: record.descripcion,
                            linea: record.linea || 'SIN LÍNEA',
                            cantidad: lote.cantidad,
                            cajas: cajasLote,
                            unidades: unidadesLote,
                            vencimiento: lote.vencimiento || null,
                            fecha: lote.fecha || null,
                            usuario: lote.usuario || usuarioActual || '',
                            device_id: deviceId
                        });
                    });
                });

                if (filas.length === 0) {
                    showToast('No hay lotes para enviar.', 'error');
                    return;
                }

                const TAM = 200;
                for (let i = 0; i < filas.length; i += TAM) {
                    const lote = filas.slice(i, i + TAM);
                    const { error } = await supabaseClient
                        .from('lotes_conteo')
                        .upsert(lote, { onConflict: 'id' });
                    if (error) throw error;
                }

                try {
                    localStorage.setItem('iem_ultimo_envio_inventario', JSON.stringify({
                        ts: Date.now(),
                        usuario: usuarioActual || '',
                        lotes: filas.length,
                        productos: inventarioFisico.length
                    }));
                } catch (e) {}

                showToast('✅ Inventario enviado (' + filas.length + ' lotes). El administrador ya puede descargarlo.', 'success');
                await sincronizarDesdeServidor();
            } catch (err) {
                console.error(err);
                showToast('❌ No se pudo enviar: ' + (err.message || err), 'error');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<span class="btn-icon">📤</span><span class="btn-label"> Enviar inventario</span>';
                }
            }
        }

        function exportarInventario() {
            if (!esAdmin()) {
                showToast('Solo el administrador puede descargar el inventario.', 'error');
                return;
            }
            if (inventarioFisico.length === 0) {
                showToast('No hay datos para exportar.', 'error');
                return;
            }

            const grupos = agruparPorLinea(inventarioFisico, d => d.linea);
            const filas = [
                ['#', 'Código', 'Descripción', 'Línea', 'Stock Teórico', 'Stock Físico', 'Diferencia', 'Vencimiento', 'Fecha/Hora', 'Usuario(s)']
            ];

            grupos.forEach(grupo => {
                filas.push([`LÍNEA: ${grupo.linea}`]);
                let contador = 1;
                let subTeorico = 0, subFisico = 0, subDiferencia = 0;
                grupo.items.forEach(d => {
                    const detalleLotes = (d.lotes || []).map(l => `${l.vencimiento || 'S/F'}: ${l.cantidad}`).join(' | ');
                    const usuarios = usuariosDeRegistro(d);
                    const usuariosTexto = usuarios.length > 1 ? `⚠️ ${usuarios.join(', ')}` : (usuarios.join(', ') || '-');
                    filas.push([contador++, d.codigo, d.descripcion, d.linea || 'SIN LÍNEA', d.stockTeorico, d.stockFisico, d.diferencia, detalleLotes || (d.vencimiento || '-'), d.fecha, usuariosTexto]);
                    subTeorico += d.stockTeorico;
                    subFisico += d.stockFisico;
                    subDiferencia += d.diferencia;
                });
                filas.push(['', '', '', 'Subtotal línea', subTeorico, subFisico, subDiferencia, '', '', '']);
                filas.push([]);
            });

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(filas);
            ws['!cols'] = [{wch:6},{wch:10},{wch:42},{wch:24},{wch:12},{wch:12},{wch:12},{wch:30},{wch:18},{wch:24}];
            XLSX.utils.book_append_sheet(wb, ws, 'InventarioFisico');
            const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([wbout], { type: 'application/octet-stream' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `inventario_fisico_${new Date().toISOString().slice(0,10)}.xlsx`;
            link.click();
            URL.revokeObjectURL(link.href);
            showToast('📥 Inventario exportado a Excel.', 'success');
        }

        // ============================================================
        // GUARDAR INVENTARIO EN DRIVE
        // ============================================================
        function guardarInventarioDrive() {
            showToast('El inventario compartido ya está en la nube (Supabase). Use Excel para descargar una copia.', 'info');
        }

        // ============================================================
        // LIMPIAR INVENTARIO
        // ============================================================
        function limpiarInventario() {
            if (!esAdmin()) {
                showToast('Solo el administrador puede limpiar el inventario.', 'error');
                return;
            }
            if (inventarioFisico.length === 0) return;
            confirmarAccion('¿Eliminar todos los registros del inventario físico? Esto también borra el conteo compartido en la nube para todos los celulares.').then(ok => {
                if (!ok) return;
                inventarioFisico = [];
                saveInventario();
                renderInventario();
                supabaseClient.from('lotes_conteo').delete().neq('id', '')
                    .then(({ error }) => { if (error) console.warn('No se pudo limpiar nube:', error); });
                showToast('Inventario limpiado (local y compartido).', 'info');
            });
        }

        // ============================================================
        // TEMA DÍA / NOCHE
        // ============================================================
        const THEME_KEY = 'buscador_tema';
        const themeToggleBtn = document.getElementById('themeToggleBtn');

        function aplicarTema(tema) {
            if (tema === 'light') {
                document.body.classList.add('light-theme');
                themeToggleBtn.textContent = '☀️';
            } else {
                document.body.classList.remove('light-theme');
                themeToggleBtn.textContent = '🌙';
            }
        }

        function cargarTema() {
            let tema = 'dark';
            try { tema = localStorage.getItem(THEME_KEY) || 'dark'; } catch(e) {}
            aplicarTema(tema);
        }

        function alternarTema() {
            const esClaro = document.body.classList.contains('light-theme');
            const nuevo = esClaro ? 'dark' : 'light';
            aplicarTema(nuevo);
            try { localStorage.setItem(THEME_KEY, nuevo); } catch(e) {}
        }

        // ============================================================
        // INICIALIZACIÓN
        // ============================================================
        // TARJETAS PLEGABLES (Inventario Físico / Sugerencia de Pedido)
        // ============================================================
        // En escritorio quedan siempre abiertas. En móvil arrancan
        // cerradas para no saturar la pantalla, y se abren solas en
        // cuanto hay algo que mostrar (o al tocar el título).
        const CARDS_PLEGABLES = {
            diff: { header: 'diffCardHeader', body: 'diffCardBody' },
            pedido: { header: 'pedidoCardHeader', body: 'pedidoCardBody' }
        };
        function esMovil() {
            return window.matchMedia('(max-width: 640px)').matches;
        }
        function setCardExpandida(nombre, expandida) {
            const cfg = CARDS_PLEGABLES[nombre];
            if (!cfg) return;
            const header = document.getElementById(cfg.header);
            const body = document.getElementById(cfg.body);
            if (!header || !body) return;
            body.classList.toggle('is-collapsed', !expandida);
            header.setAttribute('aria-expanded', expandida ? 'true' : 'false');
        }
        function toggleCard(nombre) {
            const cfg = CARDS_PLEGABLES[nombre];
            if (!cfg) return;
            const header = document.getElementById(cfg.header);
            const expandidaAhora = header.getAttribute('aria-expanded') === 'true';
            setCardExpandida(nombre, !expandidaAhora);
        }
        // Colapsa la tarjeta solo si estamos en móvil (en PC se deja abierta siempre).
        function collapseCardEnMovil(nombre) {
            if (esMovil()) setCardExpandida(nombre, false);
        }
        // Expande la tarjeta cuando aparece contenido nuevo, solo si estaba cerrada.
        function expandCardSiHaceFalta(nombre) {
            const cfg = CARDS_PLEGABLES[nombre];
            if (!cfg) return;
            const header = document.getElementById(cfg.header);
            if (header && header.getAttribute('aria-expanded') !== 'true') {
                setCardExpandida(nombre, true);
            }
        }
        function initCardsPlegables() {
            Object.keys(CARDS_PLEGABLES).forEach(nombre => {
                const cfg = CARDS_PLEGABLES[nombre];
                const header = document.getElementById(cfg.header);
                if (!header) return;
                header.addEventListener('click', () => toggleCard(nombre));
                header.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleCard(nombre);
                    }
                });
                // Estado inicial: cerradas en móvil, abiertas en escritorio.
                setCardExpandida(nombre, !esMovil());
            });
        }


        function parseFactorDesdeTexto(texto) {
            if (texto === null || texto === undefined || texto === '') return 1;
            const n = Number(texto);
            if (!isNaN(n) && n > 0) return n;
            const s = String(texto);
            // Formatos tipo CJ*12/BAR, PAQ*24/VAS, BOL*10/BOL
            let m = s.match(/[*xX]\s*(\d+)/);
            if (m) return Number(m[1]) || 1;
            m = s.match(/(\d+)\s*$/);
            return m ? Number(m[1]) : 1;
        }

        // Stock tipo "5/0" o "5/18" (cajas/unidades) → total en unidades
        function parseStockFisicoTexto(texto, factor) {
            if (texto === null || texto === undefined || texto === '') return 0;
            const n = Number(texto);
            if (!isNaN(n)) return n;
            const s = String(texto).trim();
            const m = s.match(/^(-?\d+(?:[.,]\d+)?)\s*[\/]\s*(-?\d+(?:[.,]\d+)?)/);
            if (m) {
                const cajas = Number(String(m[1]).replace(',', '.')) || 0;
                const unid = Number(String(m[2]).replace(',', '.')) || 0;
                const f = factor > 0 ? factor : 1;
                return (cajas * f) + unid;
            }
            const solo = s.match(/-?\d+(?:[.,]\d+)?/);
            return solo ? Number(solo[0].replace(',', '.')) || 0 : 0;
        }

        function valorColumna(row, nombres) {
            for (const n of nombres) {
                if (row[n] !== undefined && row[n] !== null && String(row[n]).trim() !== '') {
                    return row[n];
                }
            }
            // Columnas sin nombre (primera columna = descripción en existencias)
            for (const k of Object.keys(row)) {
                if (/^__EMPTY/i.test(k) || k === '' || k === 'null' || k === 'undefined') {
                    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
                        return row[k];
                    }
                }
            }
            return '';
        }

        function filaExcelAProducto(row) {
            const codigo = String(valorColumna(row, [
                'InventarioProductoCodigo', 'Codigo', 'codigo', 'CÓDIGO', 'Código'
            ])).trim();
            if (!codigo) return null;

            let descripcion = String(valorColumna(row, [
                'InventarioProductoDescripcion', 'Producto', 'descripcion', 'Descripcion',
                'Descripción', 'Nombre', 'producto'
            ])).trim();

            // Existencias: a veces la descripción es la única columna sin título
            if (!descripcion) {
                for (const k of Object.keys(row)) {
                    if (/^__EMPTY/i.test(k) || k === '') {
                        const v = String(row[k] || '').trim();
                        if (v && v !== codigo) { descripcion = v; break; }
                    }
                }
            }
            // Último recurso: primera columna cuyo valor no sea el código
            if (!descripcion) {
                for (const k of Object.keys(row)) {
                    const v = String(row[k] || '').trim();
                    if (v && v !== codigo && !/^(TRUE|FALSE|\d+[\/]\d+)$/i.test(v)) {
                        // evitar tomar linea/marca numéricos cortos como desc si ya hay campos
                        if (v.length > 3) { descripcion = v; break; }
                    }
                }
            }
            if (!descripcion) return null;

            const unidadRef = String(valorColumna(row, [
                'InventarioProductoUnidadReferenciaAbreviacion', 'Unidad Ref', 'unidad_ref',
                'Uni. Ref.', 'Uni. Ref', 'UnidadRef'
            ])).trim();

            const factorRaw = valorColumna(row, [
                'InventarioProductoUnidadReferenciaFactor', 'FactorEmpaque', 'factor_empaque', 'Factor'
            ]);
            const factor = factorRaw !== '' && factorRaw !== undefined
                ? parseFactorDesdeTexto(factorRaw)
                : parseFactorDesdeTexto(unidadRef);

            let cantidadRaw = valorColumna(row, [
                'InventarioProductoCantidad', 'Cantidad', 'stock_teorico', 'Stock Teorico', 'Stock'
            ]);
            if (cantidadRaw === '' || cantidadRaw === undefined) {
                cantidadRaw = valorColumna(row, ['Stock Fisico', 'Stock Físico', 'StockFisico']);
            }
            const stockTeorico = parseStockFisicoTexto(cantidadRaw, factor);

            const activoRaw = valorColumna(row, ['Activo', 'activo']);
            let activo = true;
            if (activoRaw !== '' && activoRaw !== undefined) {
                const a = String(activoRaw).trim().toLowerCase();
                activo = !(a === 'false' || a === '0' || a === 'no' || a === 'f');
            }

            return {
                codigo: codigo,
                codigo_fabrica: String(valorColumna(row, ['CodigoFabrica', 'codigo_fabrica', 'Cod. Fabrica'])).trim() || null,
                descripcion: descripcion,
                unidad_ref: unidadRef || null,
                factor_empaque: factor,
                stock_teorico: stockTeorico,
                linea: String(valorColumna(row, [
                    'InventarioProductoCategoriaDescripcion', 'Linea', 'linea', 'Línea', 'Categoria'
                ])).trim() || null,
                marca: String(valorColumna(row, [
                    'InventarioProductoProveedorNombre', 'Marca', 'marca', 'Proveedor'
                ])).trim() || null,
                activo: activo,
                actualizado_en: new Date().toISOString()
            };
        }

        async function importarExcelASupabase(file, opciones) {
            if (!file) return;
            if (typeof esAdmin === 'function' && !esAdmin()) {
                showToast('Solo el administrador puede importar el Excel.', 'error');
                return;
            }
            const soloCatalogo = !!(opciones && opciones.soloCatalogo);
            showToast('⏳ Leyendo Excel...', 'info');
            try {
                const buffer = await file.arrayBuffer();
                const wb = XLSX.read(buffer, { type: 'array' });
                const hoja = wb.Sheets[wb.SheetNames[0]];
                const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });
                if (!filas.length) { showToast('El archivo no tiene filas de datos.', 'error'); return; }
                const productos = [];
                const codigosVistos = new Set();
                filas.forEach(row => {
                    const p = filaExcelAProducto(row);
                    if (!p) return;
                    if (soloCatalogo) {
                        delete p.stock_teorico;
                    }
                    if (codigosVistos.has(p.codigo)) {
                        const idx = productos.findIndex(x => x.codigo === p.codigo);
                        if (idx >= 0) productos[idx] = p;
                    } else {
                        codigosVistos.add(p.codigo);
                        productos.push(p);
                    }
                });
                if (!productos.length) { showToast('No se encontraron productos con código y descripción.', 'error'); return; }
                showToast(`⏳ Subiendo ${productos.length} productos a la nube...`, 'info');
                const TAMANO_LOTE = 200;
                let subidos = 0;
                for (let i = 0; i < productos.length; i += TAMANO_LOTE) {
                    const lote = productos.slice(i, i + TAMANO_LOTE);
                    const { error } = await supabaseClient.from('productos').upsert(lote, { onConflict: 'codigo' });
                    if (error) throw error;
                    subidos += lote.length;
                }
                const extra = soloCatalogo ? ' (sin cambiar stock)' : '';
                showToast(`✅ ${subidos} productos actualizados en Supabase` + extra + '.', 'success');
                await loadFromGoogleSheets();
            } catch (err) {
                console.error(err);
                showToast('❌ Error al importar: ' + (err.message || err), 'error');
            }
        }

        function init() {
            cargarTema();
            themeToggleBtn.addEventListener('click', alternarTema);
            initCardsPlegables();

            poblarSelectDia();
            poblarSelectMes();
            poblarYearTabs();
            resetVencimientoAHoy();

            loadInventario();
            renderInventario();
            loadPedido();
            loadFromGoogleSheets();

            const adminPanelBtn = document.getElementById('adminPanelBtn');
            if (adminPanelBtn) {
                adminPanelBtn.addEventListener('click', abrirPanelAdmin);
            }
            const adminCloseBtn = document.getElementById('adminCloseBtn');
            const adminCancelBtn = document.getElementById('adminCancelBtn');
            if (adminCloseBtn) adminCloseBtn.addEventListener('click', cerrarPanelAdmin);
            if (adminCancelBtn) adminCancelBtn.addEventListener('click', cerrarPanelAdmin);

            // Pestañas admin (también hay delegación global más abajo)
            window.__mostrarTabAdmin = mostrarTabAdmin;

            const adminOverlay = document.getElementById('adminOverlay');
            if (adminOverlay) {
                adminOverlay.addEventListener('click', function (e) {
                    if (e.target === adminOverlay) cerrarPanelAdmin();
                });
            }
            const importExcelInput = document.getElementById('importExcelInput');
            const adminDropzone = document.getElementById('adminDropzone');
            if (importExcelInput) {
                importExcelInput.addEventListener('change', function () {
                    const file = this.files && this.files[0];
                    if (file) seleccionarArchivoAdmin(file);
                });
            }
            if (adminDropzone && importExcelInput) {
                adminDropzone.addEventListener('click', function (e) {
                    if (e.target !== importExcelInput) importExcelInput.click();
                });
                adminDropzone.addEventListener('dragover', function (e) {
                    e.preventDefault();
                    adminDropzone.classList.add('dragover');
                });
                adminDropzone.addEventListener('dragleave', function () {
                    adminDropzone.classList.remove('dragover');
                });
                adminDropzone.addEventListener('drop', function (e) {
                    e.preventDefault();
                    adminDropzone.classList.remove('dragover');
                    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
                    if (file) seleccionarArchivoAdmin(file);
                });
            }
            const adminImportBtn = document.getElementById('adminImportBtn');
            if (adminImportBtn) {
                adminImportBtn.addEventListener('click', async function () {
                    if (!adminSelectedFile) return;
                    adminImportBtn.disabled = true;
                    const statusEl = document.getElementById('adminStatus');
                    if (statusEl) statusEl.textContent = 'Subiendo...';
                    try {
                        const solo = document.getElementById('adminSoloCatalogo');
                        await importarExcelASupabase(adminSelectedFile, {
                            soloCatalogo: !!(solo && solo.checked)
                        });
                        if (statusEl) statusEl.textContent = 'Listo. Puedes cerrar el panel.';
                        setTimeout(cerrarPanelAdmin, 1200);
                    } catch (e) {
                        if (statusEl) statusEl.textContent = 'Error: ' + (e.message || e);
                        adminImportBtn.disabled = false;
                    }
                });
            }
            const adminExportInvBtn = document.getElementById('adminExportInvBtn');
            if (adminExportInvBtn) {
                adminExportInvBtn.addEventListener('click', function () {
                    if (!esAdmin()) return;
                    exportarInventario();
                });
            }
            const adminExportPedidoBtn = document.getElementById('adminExportPedidoBtn');
            if (adminExportPedidoBtn) {
                adminExportPedidoBtn.addEventListener('click', function () {
                    if (!esAdmin()) return;
                    exportarPedido();
                });
            }
            const adminRefreshSesionesBtn = document.getElementById('adminRefreshSesionesBtn');
            if (adminRefreshSesionesBtn) {
                adminRefreshSesionesBtn.addEventListener('click', function () {
                    if (!esAdmin()) return;
                    cargarSesionesActivas();
                });
            }

            // Sincronización en vivo del conteo compartido entre celulares.
            sincronizarDesdeServidor();
            if (syncTimer) clearInterval(syncTimer);
            syncTimer = setInterval(sincronizarDesdeServidor, 10000);
            try {
                supabaseClient.channel('conteos-vivos')
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'lotes_conteo' },
                        () => { sincronizarDesdeServidor(); })
                    .subscribe();
            } catch (e) { console.warn('Realtime no disponible', e); }


            refreshBtn.addEventListener('click', function() {
                const icon = this.querySelector('.btn-icon');
                if (icon) icon.textContent = '⏳';
                loadFromGoogleSheets();
                setTimeout(() => { if (icon) icon.textContent = '🔄'; }, 1500);
            });

            if (autoRefreshTimer) clearInterval(autoRefreshTimer);
            autoRefreshTimer = setInterval(loadFromGoogleSheets, 300000);
            // Al volver a la pestaña, refrescar de inmediato solo si el
            // usuario no tiene una búsqueda/selección en curso.
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && !searchInput.value.trim() && selectedIndex === -1) {
                    loadFromGoogleSheets();
                }
            });

            searchButton.addEventListener('click', performSearch);
            searchInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') performSearch(); });
            let debounceTimer;
            searchInput.addEventListener('input', () => {
                // Si había un producto seleccionado (tarjeta grande visible) y el
                // usuario vuelve a escribir en el buscador, se sale de ese modo
                // para poder elegir otro producto de la lista.
                if (selectedIndex !== -1) {
                    selectedIndex = -1;
                    limpiarCantidades();
                }
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(performSearch, 300);
            });

            // btnAgregar se enlaza más abajo (modo pedido + agregarProducto)
            txtCajas.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); txtUnidades.focus(); } });
            txtUnidades.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); agregarProducto(); } });
            txtCajas.addEventListener('input', actualizarTotalCalculado);
            txtUnidades.addEventListener('input', actualizarTotalCalculado);
            // Al salir del campo de unidades sueltas, si escribió más de lo
            // que entra en una caja, se reparte solo en cajas + unidades.
            txtUnidades.addEventListener('blur', normalizarUnidadesACajas);

            // Al tocar/enfocar la casilla de Cajas o Unidades, si tiene "0"
            // se borra por completo para que quede vacía y lista para
            // escribir directamente (en vez de sumarse al cero). Si el
            // usuario sale del campo sin escribir nada, vuelve a mostrar "0".
            [txtCajas, txtUnidades].forEach(inp => {
                function limpiarCero() {
                    if (inp.value === '0') inp.value = '';
                }
                inp.addEventListener('focus', limpiarCero);
                inp.addEventListener('click', limpiarCero);
                inp.addEventListener('touchstart', limpiarCero);
                inp.addEventListener('blur', function() {
                    if (inp.value.trim() === '') inp.value = '0';
                });
                inp.addEventListener('input', function() {
                    if (this.value.length > 1 && this.value.startsWith('0')) {
                        this.value = this.value.replace(/^0+/, '') || '0';
                    }
                });
            });

            btnRegistrarFisico.addEventListener('click', registrarFisico);
            btnCambiarProducto.addEventListener('click', volverABuscar);

            exportPedidoBtn.addEventListener('click', exportarPedido);
            guardarPedidoDriveBtn.addEventListener('click', guardarPedidoEnDrive);
            limpiarPedidoBtn.addEventListener('click', limpiarPedido);

            const btnArmarPedido = document.getElementById('btnArmarPedido');
            if (btnArmarPedido) btnArmarPedido.addEventListener('click', activarModoPedido);
            const btnSalirModoPedido = document.getElementById('btnSalirModoPedido');
            if (btnSalirModoPedido) btnSalirModoPedido.addEventListener('click', salirModoPedido);
            if (btnAgregar) btnAgregar.addEventListener('click', function () {
                if (!modoPedido) activarModoPedido();
                agregarProducto();
            });

            const enviarInventarioBtn = document.getElementById('enviarInventarioBtn');
            if (enviarInventarioBtn) enviarInventarioBtn.addEventListener('click', enviarInventarioCompleto);
            exportDiffBtn.addEventListener('click', exportarInventario);
            clearDiffBtn.addEventListener('click', limpiarInventario);
            guardarDriveBtn.addEventListener('click', guardarInventarioDrive);
        }


        // ============================================================
        // PESTAÑAS DEL PANEL ADMIN (delegación global = siempre clicables)
        // ============================================================
        function mostrarTabAdmin(tabId) {
            if (!tabId) return;
            document.querySelectorAll('.admin-nav-btn').forEach(function (b) {
                const on = b.getAttribute('data-admin-tab') === tabId;
                b.classList.toggle('active', on);
                b.setAttribute('aria-selected', on ? 'true' : 'false');
            });
            document.querySelectorAll('.admin-tab').forEach(function (panel) {
                const on = panel.getAttribute('data-admin-panel') === tabId;
                if (on) {
                    panel.hidden = false;
                    panel.removeAttribute('hidden');
                    panel.style.display = '';
                    panel.classList.add('active');
                } else {
                    panel.hidden = true;
                    panel.setAttribute('hidden', '');
                    panel.style.display = 'none';
                    panel.classList.remove('active');
                }
            });
            if (tabId === 'sesiones' && typeof cargarSesionesActivas === 'function') {
                cargarSesionesActivas();
            }
        }
        window.__mostrarTabAdmin = mostrarTabAdmin;

        // Clic / toque en menú admin (no depende de init)
        document.addEventListener('click', function (e) {
            const btn = e.target && e.target.closest && e.target.closest('.admin-nav-btn');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            const tab = btn.getAttribute('data-admin-tab');
            if (tab) mostrarTabAdmin(tab);
        }, true);

        // ============================================================
        // INICIO DE SESIÓN (usuario y clave por persona)
        // ============================================================
        // Antes la lista de usuarios y claves estaba escrita aquí mismo,
        // en texto plano, dentro del HTML — cualquiera que abriera "Ver
        // código fuente" del navegador podía leerla. Ahora la validación
        // se hace contra el Apps Script (accion: 'login'): el navegador
        // nunca recibe la lista de usuarios/claves, solo un sí/no.

        const SESSION_KEY = 'iem_sesion_activa';

        const loginOverlay = document.getElementById('loginOverlay');
        const loginUsuario = document.getElementById('loginUsuario');
        const loginClave = document.getElementById('loginClave');
        const loginError = document.getElementById('loginError');
        const loginBtn = document.getElementById('loginBtn');
        const appContainer = document.getElementById('appContainer');
        const usuarioBadge = document.getElementById('usuarioBadge');
        const usuarioBadgeTexto = document.getElementById('usuarioBadgeTexto');
        let appIniciado = false;

        // Usuario que inició sesión en este dispositivo. Se guarda junto con
        // el conteo de cada producto para poder ver, en Inventario Físico,
        // quién contó cada cosa y detectar si dos celulares (dos usuarios)
        // contaron el mismo producto por error.
        let usuarioActual = '';
        let rolUsuario = '';

        // La sesión no dura 24 horas fijas: vence apenas cambia el día del
        // calendario (por ejemplo, si entró a las 23:50, a las 00:00 ya pide
        // clave de nuevo) o cuando el usuario toca "Cerrar sesión". Por eso
        // se guarda también la fecha (día) del login y se compara contra la
        // fecha actual, en vez de contar horas transcurridas.
        function mismoDia(ts) {
            const a = new Date(ts);
            const b = new Date();
            return a.getFullYear() === b.getFullYear() &&
                   a.getMonth() === b.getMonth() &&
                   a.getDate() === b.getDate();
        }

        function sesionValida() {
            try {
                const raw = localStorage.getItem(SESSION_KEY);
                if (!raw) return false;
                const data = JSON.parse(raw);
                if (!data || !data.ts) return false;
                if (!mismoDia(data.ts)) return false;
                usuarioActual = data.usuario || '';
                rolUsuario = String(data.rol || 'usuario').toLowerCase();
                return true;
            } catch (e) {
                return false;
            }
        }

        function esAdmin() {
            return String(rolUsuario || '').toLowerCase() === 'admin';
        }

        function actualizarUIPorRol() {
            const es = esAdmin();
            const btnAdmin = document.getElementById('adminPanelBtn');
            if (btnAdmin) btnAdmin.style.display = es ? 'inline-flex' : 'none';

            // Solo admin descarga inventario / limpia conteo
            ['exportDiffBtn', 'clearDiffBtn', 'guardarDriveBtn'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = es ? '' : 'none';
            });
        }

        let adminSelectedFile = null;

        function abrirPanelAdmin() {
            if (!esAdmin()) {
                showToast('Solo el administrador puede abrir este panel.', 'error');
                return;
            }
            const ov = document.getElementById('adminOverlay');
            if (!ov) return;
            ov.classList.add('visible');
            ov.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            adminSelectedFile = null;
            const nameEl = document.getElementById('adminFileName');
            const statusEl = document.getElementById('adminStatus');
            const importBtn = document.getElementById('adminImportBtn');
            if (nameEl) nameEl.textContent = '';
            if (statusEl) statusEl.textContent = '';
            if (importBtn) importBtn.disabled = true;
            if (typeof window.__mostrarTabAdmin === 'function') window.__mostrarTabAdmin('subir');
            else cargarSesionesActivas();
            const body = ov.querySelector('.admin-panel-body');
            if (body) body.scrollTop = 0;
        }

        function cerrarPanelAdmin() {
            const ov = document.getElementById('adminOverlay');
            if (!ov) return;
            ov.classList.remove('visible');
            ov.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
            adminSelectedFile = null;
            const input = document.getElementById('importExcelInput');
            if (input) input.value = '';
        }

        function seleccionarArchivoAdmin(file) {
            if (!file) return;
            adminSelectedFile = file;
            const nameEl = document.getElementById('adminFileName');
            const importBtn = document.getElementById('adminImportBtn');
            if (nameEl) nameEl.textContent = '📄 ' + file.name + ' (' + Math.round(file.size / 1024) + ' KB)';
            if (importBtn) importBtn.disabled = false;
        }

        function mostrarApp() {
            loginOverlay.classList.add('hidden');
            appContainer.classList.remove('oculto');
            if (usuarioBadgeTexto) usuarioBadgeTexto.textContent = usuarioActual || '-';
            actualizarUIPorRol();
            registrarSesionActiva();
            if (!appIniciado) {
                appIniciado = true;
                init();
            }
        }

        function mostrarLogin() {
            appContainer.classList.add('oculto');
            loginOverlay.classList.remove('hidden');
            loginUsuario.value = '';
            loginClave.value = '';
            loginError.classList.add('hidden');
            loginUsuario.focus();
        }

        // Cierra la sesión activa: borra la marca de tiempo guardada (para
        // que sesionValida() vuelva a dar false) y regresa a la pantalla
        // de login. Pide confirmación para evitar salidas accidentales.
        function cerrarSesion() {
            confirmarAccion('¿Cerrar sesión?', 'Salir', 'primary').then(ok => {
                if (!ok) return;
                borrarSesionActiva();
                try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
                usuarioActual = '';
                rolUsuario = '';
                mostrarLogin();
            });
        }

        // Se guarda qué usuario inició sesión (además de la hora), para
        // saber si ya pasó el día y hay que volver a pedir la clave, y
        // también para poder marcar con qué usuario se registra cada
        // conteo de Inventario Físico.
        async function intentarLogin() {
            const usuario = loginUsuario.value.trim().toLowerCase();
            const clave = loginClave.value;
            if (!usuario || !clave) {
                loginError.textContent = 'Ingrese usuario y clave.';
                loginError.classList.remove('hidden');
                return;
            }
            if (!window.supabase || !supabaseClient) {
                loginError.textContent = 'Error: no se cargó Supabase. Revise su conexión o recargue la página.';
                loginError.classList.remove('hidden');
                return;
            }
            loginBtn.disabled = true;
            loginBtn.textContent = 'Verificando...';
            loginError.classList.add('hidden');
            try {
                // Primero intenta con columna rol; si no existe, cae al select básico
                let data = null;
                let error = null;
                let res = await supabaseClient
                    .from('app_usuarios')
                    .select('usuario, nombre, rol')
                    .eq('usuario', usuario)
                    .eq('clave', clave)
                    .eq('activo', true)
                    .maybeSingle();
                data = res.data;
                error = res.error;

                if (error && /rol|column/i.test(String(error.message || ''))) {
                    res = await supabaseClient
                        .from('app_usuarios')
                        .select('usuario, nombre')
                        .eq('usuario', usuario)
                        .eq('clave', clave)
                        .eq('activo', true)
                        .maybeSingle();
                    data = res.data;
                    error = res.error;
                }

                if (error) throw error;

                if (data) {
                    usuarioActual = data.usuario;
                    // admin = rol admin, o el usuario "luis" por defecto
                    const rolRaw = data.rol || (String(data.usuario).toLowerCase() === 'luis' ? 'admin' : 'usuario');
                    rolUsuario = String(rolRaw).toLowerCase();
                    try {
                        localStorage.setItem(SESSION_KEY, JSON.stringify({
                            ts: Date.now(),
                            usuario: data.usuario,
                            rol: rolUsuario
                        }));
                    } catch (e) {}
                    mostrarApp();
                } else {
                    loginError.textContent = 'Usuario o clave incorrectos.';
                    loginError.classList.remove('hidden');
                    loginClave.value = '';
                    loginClave.focus();
                }
            } catch (e) {
                console.error('Login error:', e);
                const msg = (e && e.message) ? e.message : String(e);
                loginError.textContent = 'No se pudo verificar el usuario. ' + msg;
                loginError.classList.remove('hidden');
            } finally {
                loginBtn.disabled = false;
                loginBtn.textContent = 'Entrar';
            }
        }

        loginBtn.addEventListener('click', intentarLogin);
        loginClave.addEventListener('keyup', (e) => { if (e.key === 'Enter') intentarLogin(); });
        loginUsuario.addEventListener('keyup', (e) => { if (e.key === 'Enter') loginClave.focus(); });
        document.getElementById('logoutBtn').addEventListener('click', cerrarSesion);

        if (sesionValida()) {
            mostrarApp();
        } else {
            mostrarLogin();
        }

        // sesionValida() solo se revisaba al cargar la página, así que si el
        // usuario dejaba la pestaña abierta la sesión nunca vencía sola: pasaba
        // la medianoche y la app seguía funcionando hasta que alguien recargara.
        // Este intervalo vuelve a comprobar cada minuto, y si ya cambió el día
        // (y la app está visible, no la pantalla de login) cierra la sesión sin
        // pedir confirmación y muestra el login.
        setInterval(() => {
            if (!appContainer.classList.contains('oculto') && !sesionValida()) {
                borrarSesionActiva();
                try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
                usuarioActual = '';
                rolUsuario = '';
                mostrarLogin();
            }
        }, 60000);

        // Cierre por inactividad: si pasan 20 minutos sin que la persona toque,
        // haga clic o escriba nada en la app, se cierra la sesión sola (sin
        // pedir confirmación) y vuelve a la pantalla de login. Cada evento de
        // uso reinicia el conteo.
        const INACTIVIDAD_MS = 20 * 60000; // 20 minutos
        let ultimoUso = Date.now();

        function marcarActividad() {
            ultimoUso = Date.now();
        }

        ['click', 'touchstart', 'keydown', 'scroll', 'mousemove'].forEach(ev => {
            document.addEventListener(ev, marcarActividad, { passive: true });
        });

        setInterval(() => {
            if (!appContainer.classList.contains('oculto') && Date.now() - ultimoUso >= INACTIVIDAD_MS) {
                borrarSesionActiva();
                try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
                usuarioActual = '';
                rolUsuario = '';
                mostrarLogin();
            }
        }, 60000);
    })();
