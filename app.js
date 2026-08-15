    (function() {

        // Tab admin: función global (disponible desde el primer instante)
        window.cambiarTabAdmin = function (tabId) {
            try {
                if (!tabId) return false;
                var titulos = {
                    subir: '📤 Subir Excel',
                    catalogo: '🔎 Catálogo',
                    barras: 'Barras / QR',
                    descargas: '📊 Descargas',
                    vista: '👁️ Vista previa',
                    clientes: '👤 Clientes',
                    sesiones: '👥 Sesiones'
                };
                var titleEl = document.getElementById('adminPanelTitle');
                if (titleEl) titleEl.textContent = titulos[tabId] || '⚙️ Administración';
                var activeBtn = null;
                document.querySelectorAll('.admin-nav-btn').forEach(function (b) {
                    var on = b.getAttribute('data-admin-tab') === tabId;
                    b.classList.toggle('active', on);
                    b.setAttribute('aria-selected', on ? 'true' : 'false');
                    if (on) activeBtn = b;
                });
                // En móvil: centrar la pestaña activa en la barra horizontal
                if (activeBtn && activeBtn.scrollIntoView) {
                    try {
                        activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                    } catch (e) {}
                }
                document.querySelectorAll('.admin-tab').forEach(function (panel) {
                    var on = panel.getAttribute('data-admin-panel') === tabId;
                    if (on) {
                        panel.removeAttribute('hidden');
                        panel.hidden = false;
                        panel.style.setProperty('display', 'block', 'important');
                        panel.classList.add('active');
                        panel.setAttribute('role', 'tabpanel');
                    } else {
                        panel.setAttribute('hidden', 'hidden');
                        panel.hidden = true;
                        panel.style.setProperty('display', 'none', 'important');
                        panel.classList.remove('active');
                    }
                });
                if (tabId === 'sesiones' && typeof window.__cargarSesionesActivas === 'function') {
                    window.__cargarSesionesActivas();
                }
                // En móvil no forzar focus (abre el teclado y tapa la UI)
                var esEscritorio = window.matchMedia && window.matchMedia('(min-width: 901px)').matches;
                if (tabId === 'catalogo') {
                    var inp = document.getElementById('adminCatalogInput');
                    if (inp && esEscritorio) { setTimeout(function () { inp.focus(); }, 50); }
                    if (typeof buscarCatalogoAdmin === 'function') buscarCatalogoAdmin(inp && inp.value);
                }
                if (tabId === 'barras') {
                    var binp = document.getElementById('adminBarrasInput');
                    if (binp && esEscritorio) { setTimeout(function () { binp.focus(); }, 80); }
                    if (typeof buscarBarrasAdmin === 'function') buscarBarrasAdmin(binp && binp.value);
                    if (typeof renderBarrasAdminSeleccionado === 'function') renderBarrasAdminSeleccionado();
                }
                if (tabId === 'vista' && typeof renderVistaPreviaInventario === 'function') {
                    renderVistaPreviaInventario();
                }
                if (tabId === 'clientes') {
                    if (typeof cargarClientesDesdeNube === 'function') cargarClientesDesdeNube();
                    var cin = document.getElementById('adminClienteInput');
                    if (cin && esEscritorio) setTimeout(function () { cin.focus(); }, 50);
                }
            } catch (err) {
                console.error('cambiarTabAdmin', err);
            }
            return false;
        };


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
        const SUPABASE_URL = (window.IEM_CONFIG && window.IEM_CONFIG.SUPABASE_URL) || '';
        const SUPABASE_ANON_KEY = (window.IEM_CONFIG && window.IEM_CONFIG.SUPABASE_ANON_KEY) || '';
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
            try { supabaseClient.auth.signOut(); } catch (e) {}
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
            window.__cargarSesionesActivas = cargarSesionesActivas;
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
        function getCodigoBarras(item) { return getField(item, 'CodigoBarras', 'codigo_barras', 'EAN', 'Barcode', 'CodBarras', 'CódigoBarras'); }
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

        function contarConStock() {
            let n = 0;
            (currentData || []).forEach(function (item) {
                if (getCantidad(item) > 0) n++;
            });
            return n;
        }

        function actualizarEstadoCatalogo() {
            if (!fileStatus) return;
            const total = (currentData || []).length;
            const conStock = contarConStock();
            // El buscador de inventario solo usa los que tienen stock; el catálogo admin es la referencia completa.
            fileStatus.textContent = '📦 Inventario: ' + conStock + ' con stock · Catálogo: ' + total + ' (solo consulta admin)';
        }

        async function loadFromGoogleSheets() {
            fileStatus.textContent = '⏳ Cargando productos desde Supabase...';
            try {
                // PostgREST limita ~1000 filas por request: paginar hasta traer todo
                const PAGE = 1000;
                let all = [];
                let from = 0;
                for (;;) {
                    const { data, error } = await supabaseClient
                        .from('productos')
                        .select('*')
                        .eq('activo', true)
                        .order('codigo', { ascending: true })
                        .range(from, from + PAGE - 1);
                    if (error) throw error;
                    if (!data || !data.length) break;
                    all = all.concat(data);
                    if (data.length < PAGE) break;
                    from += PAGE;
                    if (from >= 100000) break;
                    fileStatus.textContent = '⏳ Cargando productos... ' + all.length;
                }
                if (all.length > 0) {
                    currentData = all.map(p => ({
                        Codigo: p.codigo,
                        CodigoFabrica: p.codigo_fabrica || '',
                        CodigoBarras: p.codigo_barras || '',
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
                    aplicarBarrasLocalADatos();
                    actualizarEstadoCatalogo();
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
                actualizarEstadoCatalogo(); fileStatus.textContent = (fileStatus.textContent || '') + ' · respaldo ' + fechaTexto;
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
                resultList.innerHTML = (typeof modoPedido !== 'undefined' && modoPedido)
                    ? '<div class="empty-message">Escribe un código o nombre · Catálogo completo (existencias)</div>'
                    : '<div class="empty-message">Escribe un código o nombre · Solo productos con stock</div>';
                resultCount.textContent = '0';
                cajasCount.textContent = '0';
                unidadesCount.textContent = '0';
                selectedIndex = -1;
                limpiarCantidades();
                return;
            }
            const palabras = term.split(/\s+/).filter(p => p.length > 0);
            const palabrasUpper = palabras.map(p => p.toUpperCase());

            // Inventario: solo con stock. Modo pedido: catálogo completo (existencias, incluso stock 0).
            const enPedido = (typeof modoPedido !== 'undefined' && modoPedido);
            filteredData = currentData.filter(item => {
                if (!enPedido && getCantidad(item) <= 0) return false;
                const campos = [
                    getCodigo(item).toUpperCase(),
                    getCodigoFabrica(item).toUpperCase(),
                    getCodigoBarras(item).toUpperCase(),
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
                        if (typeof actualizarFilaVincular === 'function') actualizarFilaVincular();
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
            if (!esAdmin()) {
                showToast('Solo el administrador puede descargar el Excel del pedido.', 'error');
                return;
            }
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
                // Paginar por si hay más de ~1000 lotes de conteo
                const PAGE = 1000;
                let all = [];
                let from = 0;
                for (;;) {
                    const { data, error } = await supabaseClient
                        .from('lotes_conteo')
                        .select('*')
                        .order('creado_en', { ascending: true })
                        .range(from, from + PAGE - 1);
                    if (error) throw error;
                    if (!data || !data.length) break;
                    all = all.concat(data);
                    if (data.length < PAGE) break;
                    from += PAGE;
                    if (from >= 50000) break;
                }
                const registros = all.map(r => ({
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

            // Excel PLANO: sin agrupar por línea (una fila por producto)
            const filas = [
                ['#', 'Código', 'Descripción', 'Línea', 'Stock Teórico', 'Stock Físico', 'Diferencia', 'Vencimiento', 'Fecha/Hora', 'Usuario(s)']
            ];
            let contador = 1;
            let totalTeorico = 0, totalFisico = 0, totalDiff = 0;
            const ordenados = inventarioFisico.slice().sort(function (a, b) {
                return String(a.codigo || '').localeCompare(String(b.codigo || ''), 'es', { numeric: true });
            });
            ordenados.forEach(function (d) {
                const detalleLotes = (d.lotes || []).map(function (l) {
                    return (l.vencimiento || 'S/F') + ': ' + l.cantidad;
                }).join(' | ');
                const usuarios = usuariosDeRegistro(d);
                const usuariosTexto = usuarios.length > 1 ? usuarios.join(', ') : (usuarios.join(', ') || '-');
                filas.push([
                    contador++,
                    d.codigo,
                    d.descripcion,
                    d.linea || 'SIN LÍNEA',
                    d.stockTeorico,
                    d.stockFisico,
                    d.diferencia,
                    detalleLotes || (d.vencimiento || '-'),
                    d.fecha,
                    usuariosTexto
                ]);
                totalTeorico += Number(d.stockTeorico) || 0;
                totalFisico += Number(d.stockFisico) || 0;
                totalDiff += Number(d.diferencia) || 0;
            });
            filas.push(['', '', '', 'TOTAL', totalTeorico, totalFisico, totalDiff, '', '', '']);

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(filas);
            ws['!cols'] = [{wch:6},{wch:10},{wch:42},{wch:24},{wch:12},{wch:12},{wch:12},{wch:30},{wch:18},{wch:24}];
            XLSX.utils.book_append_sheet(wb, ws, 'InventarioFisico');
            const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([wbout], { type: 'application/octet-stream' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'inventario_fisico_' + new Date().toISOString().slice(0,10) + '.xlsx';
            link.click();
            URL.revokeObjectURL(link.href);
            showToast('📥 Excel plano exportado (sin agrupar por línea).', 'success');
        }

        // Vista previa agrupada por línea + PDF elegante (print)
        function construirHtmlVistaInventario() {
            if (!inventarioFisico.length) {
                return '<p class="admin-sesiones-empty">Aún no hay conteo físico registrado.</p>';
            }
            const grupos = (typeof agruparPorLinea === 'function')
                ? agruparPorLinea(inventarioFisico, function (d) { return d.linea; })
                : [{ linea: 'TODO', items: inventarioFisico }];
            let totalT = 0, totalF = 0, totalD = 0, n = 0;
            let html = '<div class="inv-preview-doc">';
            html += '<header class="inv-preview-head"><h1>IEM GROUP · Inventario físico</h1>';
            html += '<p class="inv-preview-meta">Fecha: ' + new Date().toLocaleString('es-PE') +
                ' · Usuario: ' + escapeHtmlSes(usuarioActual || '-') +
                ' · Productos: ' + inventarioFisico.length + '</p></header>';
            grupos.forEach(function (grupo) {
                let subT = 0, subF = 0, subD = 0;
                html += '<section class="inv-preview-linea"><h2>' + escapeHtmlSes(grupo.linea || 'SIN LÍNEA') + '</h2>';
                html += '<table class="inv-preview-table"><thead><tr>' +
                    '<th>#</th><th>Código</th><th>Descripción</th><th>Teórico</th><th>Físico</th><th>Dif.</th><th>Venc.</th></tr></thead><tbody>';
                (grupo.items || []).forEach(function (d, i) {
                    n++;
                    const venc = (d.lotes || []).map(function (l) {
                        return (l.vencimiento || 'S/F') + ':' + l.cantidad;
                    }).join(' · ') || (d.vencimiento || '-');
                    const difClass = (d.diferencia > 0) ? 'diff-pos' : (d.diferencia < 0 ? 'diff-neg' : '');
                    html += '<tr><td>' + (i + 1) + '</td><td class="mono">' + escapeHtmlSes(d.codigo) +
                        '</td><td>' + escapeHtmlSes(d.descripcion) +
                        '</td><td class="num">' + d.stockTeorico +
                        '</td><td class="num">' + d.stockFisico +
                        '</td><td class="num ' + difClass + '">' + d.diferencia +
                        '</td><td class="venc">' + escapeHtmlSes(venc) + '</td></tr>';
                    subT += Number(d.stockTeorico) || 0;
                    subF += Number(d.stockFisico) || 0;
                    subD += Number(d.diferencia) || 0;
                });
                html += '</tbody><tfoot><tr><td colspan="3">Subtotal línea</td><td class="num">' + subT +
                    '</td><td class="num">' + subF + '</td><td class="num">' + subD + '</td><td></td></tr></tfoot></table></section>';
                totalT += subT; totalF += subF; totalD += subD;
            });
            html += '<footer class="inv-preview-foot"><strong>TOTAL</strong> · Teórico: ' + totalT +
                ' · Físico: ' + totalF + ' · Diferencia: ' + totalD + ' · Ítems: ' + n + '</footer></div>';
            return html;
        }

        function renderVistaPreviaInventario() {
            const box = document.getElementById('adminVistaPreview');
            if (!box) return;
            box.innerHTML = construirHtmlVistaInventario();
        }

        function exportarInventarioPDF() {
            if (!esAdmin()) {
                showToast('Solo el administrador puede exportar PDF.', 'error');
                return;
            }
            if (!inventarioFisico.length) {
                showToast('No hay inventario para el PDF.', 'error');
                return;
            }
            const contenido = construirHtmlVistaInventario();
            const w = window.open('', '_blank', 'noopener,noreferrer');
            if (!w) {
                showToast('Permite ventanas emergentes para generar el PDF.', 'error');
                return;
            }
            w.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Inventario físico IEM</title>');
            w.document.write('<style>');
            w.document.write('*{box-sizing:border-box}body{font-family:Inter,Segoe UI,Arial,sans-serif;color:#1a1a2e;margin:0;padding:24px;background:#fff}');
            w.document.write('.inv-preview-head{border-bottom:3px solid #5b45d6;padding-bottom:12px;margin-bottom:20px}');
            w.document.write('.inv-preview-head h1{margin:0;font-size:1.35rem;color:#3b2494}');
            w.document.write('.inv-preview-meta{margin:6px 0 0;color:#555;font-size:0.85rem}');
            w.document.write('.inv-preview-linea{margin-bottom:22px;page-break-inside:avoid}');
            w.document.write('.inv-preview-linea h2{margin:0 0 8px;font-size:1rem;color:#5b45d6;border-left:4px solid #22d3ee;padding-left:8px}');
            w.document.write('.inv-preview-table{width:100%;border-collapse:collapse;font-size:0.78rem}');
            w.document.write('.inv-preview-table th{background:#eef2ff;text-align:left;padding:6px 8px;border-bottom:2px solid #c7d2fe}');
            w.document.write('.inv-preview-table td{padding:5px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top}');
            w.document.write('.inv-preview-table tfoot td{font-weight:700;background:#f8fafc}');
            w.document.write('.mono{font-family:ui-monospace,monospace;font-weight:600}');
            w.document.write('.num{text-align:right;font-variant-numeric:tabular-nums}');
            w.document.write('.diff-pos{color:#059669}.diff-neg{color:#e11d48}');
            w.document.write('.venc{font-size:0.72rem;color:#555;max-width:140px}');
            w.document.write('.inv-preview-foot{margin-top:16px;padding-top:12px;border-top:2px solid #5b45d6;font-size:0.9rem}');
            w.document.write('@media print{body{padding:12px}@page{margin:12mm}}');
            w.document.write('</style></head><body>');
            w.document.write(contenido);
            w.document.write('<script>window.onload=function(){setTimeout(function(){window.print()},300);}<\/script>');
            w.document.write('</body></html>');
            w.document.close();
            showToast('PDF: usa “Guardar como PDF” en el diálogo de impresión.', 'info');
        }

        // Buscador admin de catálogo completo (existencias)
        function buscarCatalogoAdmin(term) {
            const list = document.getElementById('adminCatalogList');
            const countEl = document.getElementById('adminCatalogCount');
            if (!list) return;
            const soloCero = !!(document.getElementById('adminCatalogSoloCero') && document.getElementById('adminCatalogSoloCero').checked);
            const q = String(term || '').trim().toUpperCase();
            // Catálogo admin: TODOS los productos (con o sin stock). Nunca filtra stock salvo "solo sin stock".
            let base = (currentData || []).slice();
            if (soloCero) {
                base = base.filter(function (item) { return getCantidad(item) <= 0; });
            }
            if (!q) {
                if (soloCero) {
                    const hits0 = base.slice(0, 100);
                    if (countEl) countEl.textContent = String(base.length);
                    if (!hits0.length) {
                        list.innerHTML = '<p class="admin-sesiones-empty">No hay productos sin stock.</p>';
                        return;
                    }
                    list.innerHTML = hits0.map(function (item) {
                        const cod = escapeHtmlSes(getCodigo(item));
                        const desc = escapeHtmlSes(getDescripcion(item));
                        const lin = escapeHtmlSes(getLinea(item) || '-');
                        const mar = escapeHtmlSes(getMarca(item) || '-');
                        const cant = getCantidad(item);
                        return '<div class="admin-catalog-item stock-cero">' +
                            '<div class="aci-cod">' + cod + '</div>' +
                            '<div class="aci-desc">' + desc + '</div>' +
                            '<div class="aci-meta">Línea: ' + lin + ' · Marca: ' + mar +
                            ' · Stock: <strong>' + cant + '</strong></div></div>';
                    }).join('');
                    return;
                }
                list.innerHTML = '<p class="admin-sesiones-empty">Escribe para buscar. Incluye productos con y sin stock.</p>';
                if (countEl) countEl.textContent = String((currentData || []).length);
                return;
            }
            const palabras = q.split(/\s+/).filter(Boolean);
            const hits = base.filter(function (item) {
                const campos = [
                    getCodigo(item), getCodigoFabrica(item), getDescripcion(item),
                    getLinea(item), getMarca(item), getUnidadRef(item)
                ].map(function (x) { return String(x || '').toUpperCase(); });
                return palabras.every(function (p) {
                    return campos.some(function (c) { return c.indexOf(p) !== -1; });
                });
            }).slice(0, 80);
            if (countEl) countEl.textContent = String(hits.length) + (hits.length >= 80 ? '+' : '');
            if (!hits.length) {
                list.innerHTML = '<p class="admin-sesiones-empty">Sin coincidencias en el catálogo.</p>';
                return;
            }
            list.innerHTML = hits.map(function (item) {
                const cod = escapeHtmlSes(getCodigo(item));
                const desc = escapeHtmlSes(getDescripcion(item));
                const lin = escapeHtmlSes(getLinea(item) || '-');
                const mar = escapeHtmlSes(getMarca(item) || '-');
                const cant = getCantidad(item);
                const stockClass = cant <= 0 ? 'stock-cero' : '';
                return '<div class="admin-catalog-item ' + stockClass + '">' +
                    '<div class="aci-cod">' + cod + '</div>' +
                    '<div class="aci-desc">' + desc + '</div>' +
                    '<div class="aci-meta">Línea: ' + lin + ' · Marca: ' + mar +
                    ' · Stock: <strong>' + cant + '</strong></div></div>';
            }).join('');
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
            } else {
                document.body.classList.remove('light-theme');
            }
            if (themeToggleBtn) {
                themeToggleBtn.textContent = tema === 'light' ? '☀️' : '🌙';
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

        function normalizarClaveCol(s) {
            return String(s || '')
                .trim()
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '') // quita tildes
                .replace(/[\s._\-]+/g, '');
        }

        function valorColumna(row, nombres) {
            if (!row || typeof row !== 'object') return '';
            // Coincidencia exacta
            for (const n of nombres) {
                if (row[n] !== undefined && row[n] !== null && String(row[n]).trim() !== '') {
                    return row[n];
                }
            }
            // Coincidencia sin importar mayúsculas / tildes / espacios
            const mapa = {};
            Object.keys(row).forEach(function (k) {
                mapa[normalizarClaveCol(k)] = k;
            });
            for (const n of nombres) {
                const real = mapa[normalizarClaveCol(n)];
                if (real !== undefined && row[real] !== undefined && row[real] !== null && String(row[real]).trim() !== '') {
                    return row[real];
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

            const producto = {
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
            // Solo incluir codigo_barras si el Excel trae un valor real.
            // Así no se borran los códigos de barras/QR ya guardados en la nube.
            const barrasExcel = String(valorColumna(row, [
                'CodigoBarras', 'codigo_barras', 'EAN', 'Barcode', 'CodBarras', 'CódigoBarras'
            ])).trim();
            if (barrasExcel) producto.codigo_barras = barrasExcel;
            return producto;
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


        // ============================================================
        // ESCÁNER CÓDIGO DE BARRAS / QR (solo admin por ahora)
        // ============================================================
        let html5QrCode = null;
        let scanModo = 'buscar'; // 'buscar' | 'vincular'
        const BARRAS_LOCAL_KEY = 'iem_codigo_barras_local';

        function cargarBarrasLocal() {
            try {
                return JSON.parse(localStorage.getItem(BARRAS_LOCAL_KEY) || '{}') || {};
            } catch (e) { return {}; }
        }
        function guardarBarrasLocal(mapa) {
            try { localStorage.setItem(BARRAS_LOCAL_KEY, JSON.stringify(mapa)); } catch (e) {}
        }
        function aplicarBarrasLocalADatos() {
            const mapa = cargarBarrasLocal();
            (currentData || []).forEach(function (item) {
                const cod = getCodigo(item);
                if (mapa[cod] && !getCodigoBarras(item)) {
                    item.CodigoBarras = mapa[cod];
                }
            });
        }

        async function detenerEscaner() {
            try {
                if (html5QrCode) {
                    const running = html5QrCode.isScanning;
                    if (running) await html5QrCode.stop();
                    await html5QrCode.clear();
                }
            } catch (e) {}
            html5QrCode = null;
            const ov = document.getElementById('scanOverlay');
            if (ov) {
                ov.classList.remove('visible');
                ov.setAttribute('aria-hidden', 'true');
            }
        }

        async function abrirEscaner(modo) {
            if (!esAdmin()) {
                showToast('El escáner está disponible solo para el administrador por ahora.', 'error');
                return;
            }
            if (typeof Html5Qrcode === 'undefined') {
                showToast('No se cargó el lector. Revisa tu conexión.', 'error');
                return;
            }
            scanModo = modo || 'buscar';
            const ov = document.getElementById('scanOverlay');
            const title = document.getElementById('scanTitle');
            const hint = document.getElementById('scanHint');
            const status = document.getElementById('scanStatus');
            if (title) {
                var ico = '<span class="ico-scan" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M2 7h1.5v10H2V7zm2.5 0H6v10H4.5V7zM7 7h1.2v10H7V7zm2.2 0h2v10h-2V7zm3 0h1.2v10H12.2V7z"/><path fill="currentColor" d="M15 7h3.5v3.5H15V7zm1 1v1.5h1.5V8H16zm2.5 4.5H22V15h-1.5v1.5H18v-1.5h-.5v-1.5H18v-1.5h-.5zM15 15h2v2h-2v-2z"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M3 5h3M3 5v3M21 5h-3M21 5v3M3 19h3M3 19v-3M21 19h-3M21 19v-3"/></svg></span> ';
                title.innerHTML = ico + (scanModo === 'vincular' ? 'Vincular código de barras' : 'Escanear código');
            }
            if (hint) {
                let codHint = '';
                if (scanModo === 'vincular') {
                    if (barrasAdminSeleccionado) codHint = getCodigo(barrasAdminSeleccionado);
                    else if (selectedIndex >= 0 && filteredData[selectedIndex]) codHint = getCodigo(filteredData[selectedIndex]);
                }
                hint.textContent = scanModo === 'vincular'
                    ? 'Escanea el código del envase para asociarlo al producto seleccionado' + (codHint ? ' (' + codHint + ')' : '') + '.'
                    : 'Apunta al código de barras o QR. Debe estar guardado en el catálogo para encontrarlo.';
            }
            if (status) status.textContent = 'Iniciando cámara...';
            if (ov) {
                ov.classList.add('visible');
                ov.setAttribute('aria-hidden', 'false');
            }
            try {
                await detenerEscaner();
                if (ov) {
                    ov.classList.add('visible');
                    ov.setAttribute('aria-hidden', 'false');
                }
                html5QrCode = new Html5Qrcode('scanReader');
                await html5QrCode.start(
                    { facingMode: 'environment' },
                    { fps: 8, qrbox: { width: 260, height: 140 } },
                    onScanSuccess,
                    function () {}
                );
                if (status) status.textContent = 'Cámara lista. Apunta al código...';
            } catch (e) {
                console.error(e);
                if (status) status.textContent = 'No se pudo abrir la cámara. Revisa permisos.';
                showToast('Sin acceso a la cámara.', 'error');
            }
        }

        async function onScanSuccess(decodedText) {
            const code = String(decodedText || '').trim();
            if (!code) return;
            try { await detenerEscaner(); } catch (e) {}
            if (scanModo === 'vincular') {
                await vincularCodigoBarras(code);
            } else {
                searchInput.value = code;
                performSearch();
                if (!filteredData.length) {
                    showToast('Código leído: ' + code + ' — aún no está asociado a un producto. Selecciona el producto y usa «Vincular».', 'info');
                } else {
                    showToast('Encontrado: ' + code, 'success');
                    if (filteredData.length === 1) {
                        selectedIndex = 0;
                        document.querySelectorAll('.result-item').forEach(function (el, i) {
                            el.classList.toggle('selected', i === 0);
                        });
                        actualizarCantidades(filteredData[0]);
                    }
                }
            }
        }

        // Producto seleccionado en la herramienta admin de barras (sin pasar por conteo)
        let barrasAdminSeleccionado = null;

        async function vincularCodigoBarras(ean, codigoForzado) {
            if (!esAdmin()) return;
            let item = null;
            let codigo = codigoForzado ? String(codigoForzado).trim() : '';
            if (codigo) {
                item = (currentData || []).find(function (x) { return getCodigo(x) === codigo; })
                    || (filteredData || []).find(function (x) { return getCodigo(x) === codigo; });
            } else if (barrasAdminSeleccionado) {
                codigo = getCodigo(barrasAdminSeleccionado);
                item = barrasAdminSeleccionado;
            } else if (selectedIndex >= 0 && selectedIndex < filteredData.length) {
                item = filteredData[selectedIndex];
                codigo = getCodigo(item);
            }
            if (!codigo) {
                showToast('Primero busca y selecciona el producto.', 'error');
                return;
            }
            if (!item) {
                item = (currentData || []).find(function (x) { return getCodigo(x) === codigo; });
            }
            if (item) item.CodigoBarras = ean;
            // Local backup
            const mapa = cargarBarrasLocal();
            mapa[codigo] = ean;
            guardarBarrasLocal(mapa);
            // Supabase
            try {
                const { error } = await supabaseClient.from('productos').update({
                    codigo_barras: ean,
                    actualizado_en: new Date().toISOString()
                }).eq('codigo', codigo);
                if (error) throw error;
                showToast('Barras ' + ean + ' → producto ' + codigo + ' (guardado en nube).', 'success');
            } catch (e) {
                console.warn(e);
                showToast('Barras guardado en este dispositivo. Revisa la columna codigo_barras en Supabase: ' + (e.message || ''), 'info');
            }
            // sync currentData
            const orig = (currentData || []).find(function (x) { return getCodigo(x) === codigo; });
            if (orig) orig.CodigoBarras = ean;
            if (barrasAdminSeleccionado && getCodigo(barrasAdminSeleccionado) === codigo) {
                barrasAdminSeleccionado.CodigoBarras = ean;
            }
            actualizarFilaVincular();
            if (typeof renderBarrasAdminSeleccionado === 'function') renderBarrasAdminSeleccionado();
            if (typeof buscarBarrasAdmin === 'function') {
                const inp = document.getElementById('adminBarrasInput');
                buscarBarrasAdmin(inp && inp.value);
            }
        }

        function actualizarFilaVincular() {
            const row = document.getElementById('vincularBarrasRow');
            if (!row) return;
            if (!esAdmin() || selectedIndex < 0 || selectedIndex >= filteredData.length) {
                row.style.display = 'none';
                return;
            }
            row.style.display = 'block';
            const item = filteredData[selectedIndex];
            const ean = getCodigoBarras(item);
            const btn = document.getElementById('btnVincularBarras');
            if (btn) {
                btn.innerHTML = ean
                    ? '<span class="btn-icon">🏷️</span><span class="btn-label"> Barras: ' + ean + ' (cambiar)</span>'
                    : '<span class="btn-icon">🏷️</span><span class="btn-label"> Vincular código de barras a este producto</span>';
            }
        }

        // ============================================================
        // ADMIN: asociar códigos de barras / QR (sin conteo)
        // ============================================================
        function buscarBarrasAdmin(term) {
            const list = document.getElementById('adminBarrasList');
            const countEl = document.getElementById('adminBarrasCount');
            if (!list) return;
            const soloSin = !!(document.getElementById('adminBarrasSoloSin') && document.getElementById('adminBarrasSoloSin').checked);
            const q = String(term || '').trim().toUpperCase();
            let base = (currentData || []).slice();
            if (soloSin) {
                base = base.filter(function (item) { return !getCodigoBarras(item); });
            }
            if (!q) {
                if (soloSin) {
                    const hits0 = base.slice(0, 120);
                    if (countEl) countEl.textContent = String(base.length);
                    if (!hits0.length) {
                        list.innerHTML = '<p class="admin-sesiones-empty">Todos los productos ya tienen código de barras.</p>';
                        return;
                    }
                    list.innerHTML = hits0.map(function (item) { return htmlItemBarrasAdmin(item); }).join('');
                    return;
                }
                list.innerHTML = '<p class="admin-sesiones-empty">Escribe para buscar, o marca «solo sin barras» para listar pendientes.</p>';
                if (countEl) {
                    const sin = (currentData || []).filter(function (it) { return !getCodigoBarras(it); }).length;
                    countEl.textContent = sin + ' sin barras / ' + (currentData || []).length;
                }
                return;
            }
            const palabras = q.split(/\s+/).filter(Boolean);
            const hits = base.filter(function (item) {
                const campos = [
                    getCodigo(item), getCodigoFabrica(item), getDescripcion(item),
                    getLinea(item), getMarca(item), getCodigoBarras(item), getUnidadRef(item)
                ].map(function (x) { return String(x || '').toUpperCase(); });
                return palabras.every(function (p) {
                    return campos.some(function (c) { return c.indexOf(p) !== -1; });
                });
            }).slice(0, 100);
            if (countEl) countEl.textContent = String(hits.length) + (hits.length >= 100 ? '+' : '');
            if (!hits.length) {
                list.innerHTML = '<p class="admin-sesiones-empty">Sin coincidencias.</p>';
                return;
            }
            list.innerHTML = hits.map(function (item) { return htmlItemBarrasAdmin(item); }).join('');
        }

        function htmlItemBarrasAdmin(item) {
            const cod = escapeHtmlSes(getCodigo(item));
            const desc = escapeHtmlSes(getDescripcion(item));
            const lin = escapeHtmlSes(getLinea(item) || '-');
            const mar = escapeHtmlSes(getMarca(item) || '-');
            const ean = getCodigoBarras(item);
            const eanHtml = ean
                ? '<span class="aci-barras ok">🏷️ ' + escapeHtmlSes(ean) + '</span>'
                : '<span class="aci-barras pendiente">Sin barras</span>';
            const sel = barrasAdminSeleccionado && getCodigo(barrasAdminSeleccionado) === getCodigo(item) ? ' selected' : '';
            const sinClass = ean ? '' : ' sin-barras';
            return '<div class="admin-catalog-item admin-barras-item' + sinClass + sel + '" data-codigo="' + cod + '" role="button" tabindex="0">' +
                '<div class="aci-cod">' + cod + '</div>' +
                '<div class="aci-desc">' + desc + '</div>' +
                '<div class="aci-meta">Línea: ' + lin + ' · Marca: ' + mar + ' · ' + eanHtml + '</div></div>';
        }

        function seleccionarProductoBarrasAdmin(codigo) {
            const item = (currentData || []).find(function (x) { return getCodigo(x) === String(codigo); });
            if (!item) {
                showToast('Producto no encontrado en el catálogo.', 'error');
                return;
            }
            barrasAdminSeleccionado = item;
            renderBarrasAdminSeleccionado();
            const inp = document.getElementById('adminBarrasInput');
            buscarBarrasAdmin(inp && inp.value);
            // No forzar focus al input (abre teclado y tapa la pantalla).
            // Solo desplazar la tarjeta del producto a la zona visible.
            const box = document.getElementById('adminBarrasSelected');
            if (box && box.scrollIntoView) {
                setTimeout(function () {
                    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }, 50);
            }
        }

        function renderBarrasAdminSeleccionado() {
            const box = document.getElementById('adminBarrasSelected');
            if (!box) return;
            if (!barrasAdminSeleccionado) {
                box.innerHTML = '<p class="admin-sesiones-empty">Selecciona un producto de la lista para asociarle un código de barras o QR.</p>';
                box.classList.remove('has-product');
                return;
            }
            const item = barrasAdminSeleccionado;
            const cod = escapeHtmlSes(getCodigo(item));
            const desc = escapeHtmlSes(getDescripcion(item));
            const fab = escapeHtmlSes(getCodigoFabrica(item) || '-');
            const ean = getCodigoBarras(item);
            const eanTxt = ean ? escapeHtmlSes(ean) : '— sin asignar —';
            box.classList.add('has-product');
            box.innerHTML =
                '<div class="barras-sel-info">' +
                '<div class="barras-sel-cod">' + cod + '</div>' +
                '<div class="barras-sel-desc">' + desc + '</div>' +
                '<div class="barras-sel-meta">Cód. fábrica: ' + fab + '</div>' +
                '<div class="barras-sel-ean">Barras actual: <strong>' + eanTxt + '</strong></div>' +
                '</div>' +
                '<div class="barras-sel-actions">' +
                '<button type="button" class="btn btn-primary btn-sm btn-scan" id="adminBarrasScanBtn">' +
                '<span class="btn-icon btn-scan-ico ico-scan" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M2 7h1.5v10H2V7zm2.5 0H6v10H4.5V7zM7 7h1.2v10H7V7zm2.2 0h2v10h-2V7zm3 0h1.2v10H12.2V7z"/><path fill="currentColor" d="M15 7h3.5v3.5H15V7zm1 1v1.5h1.5V8H16zm2.5 4.5H22V15h-1.5v1.5H18v-1.5h-.5v-1.5H18v-1.5h-.5zM15 15h2v2h-2v-2z"/></svg></span>' +
                '<span class="btn-label"> Escanear QR / barras</span></button>' +
                '<div class="barras-manual-row">' +
                '<input type="text" id="adminBarrasManual" class="barras-manual-input" placeholder="O escribe el EAN / QR..." inputmode="numeric" autocomplete="off" value="' + escapeHtmlSes(ean || '') + '">' +
                '<button type="button" class="btn btn-success btn-sm" id="adminBarrasSaveBtn">Asociar</button>' +
                '</div>' +
                (ean ? '<button type="button" class="btn btn-outline btn-sm" id="adminBarrasClearBtn">Quitar código de barras</button>' : '') +
                '</div>';
            const scanBtn = document.getElementById('adminBarrasScanBtn');
            if (scanBtn) scanBtn.addEventListener('click', function () {
                abrirEscaner('vincular');
            });
            const saveBtn = document.getElementById('adminBarrasSaveBtn');
            if (saveBtn) saveBtn.addEventListener('click', function () {
                const v = (document.getElementById('adminBarrasManual') || {}).value;
                const code = String(v || '').trim();
                if (!code) {
                    showToast('Escribe o escanea un código de barras / QR.', 'error');
                    return;
                }
                vincularCodigoBarras(code, getCodigo(item));
            });
            const clearBtn = document.getElementById('adminBarrasClearBtn');
            if (clearBtn) clearBtn.addEventListener('click', function () {
                quitarCodigoBarrasAdmin(getCodigo(item));
            });
            const manual = document.getElementById('adminBarrasManual');
            if (manual) {
                manual.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        if (saveBtn) saveBtn.click();
                    }
                });
            }
        }

        async function quitarCodigoBarrasAdmin(codigo) {
            if (!esAdmin() || !codigo) return;
            try {
                const { error } = await supabaseClient.from('productos').update({
                    codigo_barras: null,
                    actualizado_en: new Date().toISOString()
                }).eq('codigo', codigo);
                if (error) throw error;
            } catch (e) {
                showToast('No se pudo quitar en la nube: ' + (e.message || e), 'error');
                return;
            }
            const mapa = cargarBarrasLocal();
            delete mapa[codigo];
            guardarBarrasLocal(mapa);
            const orig = (currentData || []).find(function (x) { return getCodigo(x) === codigo; });
            if (orig) orig.CodigoBarras = '';
            if (barrasAdminSeleccionado && getCodigo(barrasAdminSeleccionado) === codigo) {
                barrasAdminSeleccionado.CodigoBarras = '';
            }
            showToast('Código de barras quitado de ' + codigo + '.', 'success');
            renderBarrasAdminSeleccionado();
            const inp = document.getElementById('adminBarrasInput');
            buscarBarrasAdmin(inp && inp.value);
        }

        // ============================================================
        // CATÁLOGO CLIENTES (solo admin)
        // ============================================================
        let clientesData = [];

        function escapeCli(s) {
            return String(s || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        function filaExcelACliente(row) {
            const codigo = String(valorColumna(row, [
                'Codigo', 'codigo', 'Código', 'CÓDIGO', 'CodCliente', 'Cod. Cliente',
                'CodigoCliente', 'Código Cliente', 'Cod', 'ID', 'IdCliente', 'ClienteCodigo'
            ])).trim();
            if (!codigo) return null;
            const nombre = String(valorColumna(row, [
                'Nombre', 'nombre', 'RazonSocial', 'Razón Social', 'Cliente',
                'NombreCliente', 'Razon Social', 'Descripcion', 'Descripción'
            ])).trim();
            if (!nombre) return null;
            return {
                codigo: codigo,
                nombre: nombre,
                categoria: String(valorColumna(row, ['CategoriaCliente', 'Categoria', 'categoría', 'CategoriaCli', 'Categoria Cliente'])).trim() || null,
                tipo_cliente: String(valorColumna(row, ['TipoCliente', 'Tipo', 'tipo_cliente', 'Tipo Cliente'])).trim() || null,
                tipo_doc: String(valorColumna(row, ['TipoDocidentidad', 'TipoDoc', 'Tipo Documento', 'TipoDocIdentidad'])).trim() || null,
                doc_identidad: String(valorColumna(row, ['Docidentidad', 'DocIdentidad', 'DNI', 'RUC', 'Documento', 'NroDocumento', 'Doc'])).trim() || null,
                direccion: String(valorColumna(row, ['Direccion', 'Dirección', 'direccion', 'Dir'])).trim() || null,
                distrito: String(valorColumna(row, ['Distrito', 'distrito'])).trim() || null,
                codigo_zona: String(valorColumna(row, ['CodigoZona', 'CódigoZona', 'CodZona', 'Zona', 'Codigo Zona'])).trim() || null,
                descripcion_zona: String(valorColumna(row, ['DescripcionZona', 'Descripcion1', 'ZonaDesc', 'Descripcion Zona'])).trim() || null,
                linea_credito: (function () {
                    const v = valorColumna(row, ['LineaCredito', 'Linea de Credito', 'Credito', 'Línea Crédito', 'LineaCredito']);
                    if (v === '' || v === undefined || v === null) return null;
                    const n = Number(String(v).replace(/[^\d.,\-]/g, '').replace(',', '.'));
                    return isNaN(n) ? null : n;
                })(),
                actualizado_en: new Date().toISOString()
            };
        }

        function setClientesImportMsg(msg) {
            const st = document.getElementById('adminClientesStatus');
            const st2 = document.getElementById('adminClientesImportStatus');
            if (st) st.textContent = msg;
            if (st2) st2.textContent = msg;
        }

        async function importarClientesExcel(file) {
            if (!esAdmin()) {
                showToast('Solo el administrador puede importar clientes.', 'error');
                return;
            }
            if (!file) return;
            if (typeof XLSX === 'undefined') {
                showToast('No se cargó la librería Excel. Recarga la página.', 'error');
                return;
            }
            const box = document.getElementById('adminClientesImportBox');
            if (box) box.open = true;
            setClientesImportMsg('Leyendo ' + file.name + '...');
            try {
                const buffer = await file.arrayBuffer();
                const wb = XLSX.read(buffer, { type: 'array' });
                if (!wb.SheetNames || !wb.SheetNames.length) {
                    throw new Error('El archivo no tiene hojas.');
                }
                const hoja = wb.Sheets[wb.SheetNames[0]];
                const filas = XLSX.utils.sheet_to_json(hoja, { defval: '', raw: false });
                const lista = [];
                const vistos = new Set();
                filas.forEach(function (row) {
                    const c = filaExcelACliente(row);
                    if (!c) return;
                    if (vistos.has(c.codigo)) {
                        const i = lista.findIndex(function (x) { return x.codigo === c.codigo; });
                        if (i >= 0) lista[i] = c;
                    } else {
                        vistos.add(c.codigo);
                        lista.push(c);
                    }
                });
                if (!lista.length) {
                    const cols = filas[0] ? Object.keys(filas[0]).join(', ') : '(vacío)';
                    setClientesImportMsg('No se leyeron clientes. Columnas del Excel: ' + cols);
                    showToast('Excel sin filas con Código + Nombre.', 'error');
                    return;
                }
                setClientesImportMsg('Subiendo ' + lista.length + ' clientes a Supabase...');
                const TAM = 150;
                let n = 0;
                for (let i = 0; i < lista.length; i += TAM) {
                    const lote = lista.slice(i, i + TAM);
                    const { error } = await supabaseClient
                        .from('clientes')
                        .upsert(lote, { onConflict: 'codigo' });
                    if (error) {
                        const detalle = (error.message || '') + (error.details ? ' — ' + error.details : '') + (error.hint ? ' — ' + error.hint : '');
                        throw new Error(detalle || JSON.stringify(error));
                    }
                    n += lote.length;
                    setClientesImportMsg('Subidos ' + n + ' / ' + lista.length + '...');
                }
                // Volver a leer desde la nube para confirmar que sí quedaron guardados
                setClientesImportMsg('Verificando en la nube...');
                await cargarClientesDesdeNube();
                const enNube = (clientesData && clientesData.length) || 0;
                setClientesImportMsg('✅ Guardados ' + n + ' del Excel. En nube ahora: ' + enNube + '.');
                showToast('✅ ' + n + ' clientes guardados en Supabase.', 'success');
            } catch (e) {
                console.error('importarClientesExcel', e);
                const msg = (e && e.message) ? e.message : String(e);
                setClientesImportMsg('Error: ' + msg);
                showToast('Error al guardar clientes: ' + msg, 'error');
            }
        }

        async function cargarClientesDesdeNube() {
            if (!esAdmin()) return;
            const st = document.getElementById('adminClientesStatus');
            try {
                // Supabase/PostgREST limita ~1000 filas por petición: hay que paginar
                const PAGE = 1000;
                let all = [];
                let from = 0;
                for (;;) {
                    const { data, error } = await supabaseClient
                        .from('clientes')
                        .select('*')
                        .order('nombre', { ascending: true })
                        .range(from, from + PAGE - 1);
                    if (error) throw error;
                    if (!data || !data.length) break;
                    all = all.concat(data);
                    if (data.length < PAGE) break;
                    from += PAGE;
                    // Tope de seguridad
                    if (from >= 50000) break;
                }
                clientesData = all;
                if (st) st.textContent = clientesData.length
                    ? ('✅ ' + clientesData.length + ' clientes en la nube.')
                    : 'Sin clientes en la nube. Usa “Actualizar base” abajo.';
                const inp = document.getElementById('adminClienteInput');
                buscarClientesAdmin(inp ? inp.value : '');
            } catch (e) {
                if (st) st.textContent = 'No se pudo cargar (¿tabla clientes?). ' + (e.message || '');
                console.warn(e);
            }
        }

        function buscarClientesAdmin(term) {
            const list = document.getElementById('adminClienteList');
            const countEl = document.getElementById('adminClienteCount');
            if (!list) return;
            const q = String(term || '').trim().toUpperCase();
            if (!clientesData.length) {
                list.innerHTML = '<p class="admin-sesiones-empty">No hay clientes cargados. Sube el Excel.</p>';
                if (countEl) countEl.textContent = '0';
                return;
            }
            let hits = clientesData;
            if (q) {
                const palabras = q.split(/\s+/).filter(Boolean);
                hits = clientesData.filter(function (c) {
                    const campos = [
                        c.codigo, c.nombre, c.categoria, c.tipo_cliente,
                        c.doc_identidad, c.direccion, c.distrito,
                        c.codigo_zona, c.descripcion_zona
                    ].map(function (x) { return String(x || '').toUpperCase(); });
                    return palabras.every(function (p) {
                        return campos.some(function (f) { return f.indexOf(p) !== -1; });
                    });
                });
            }
            if (countEl) countEl.textContent = String(hits.length);
            const show = hits.slice(0, 60);
            if (!show.length) {
                list.innerHTML = '<p class="admin-sesiones-empty">Sin coincidencias.</p>';
                return;
            }
            list.innerHTML = show.map(function (c) {
                return '<div class="admin-catalog-item">' +
                    '<div class="aci-cod">' + escapeCli(c.codigo) + ' · ' + escapeCli(c.nombre) + '</div>' +
                    '<div class="aci-desc">' + escapeCli(c.direccion || '-') +
                    (c.distrito ? ' — ' + escapeCli(c.distrito) : '') + '</div>' +
                    '<div class="aci-meta">' +
                    escapeCli(c.tipo_doc || '') + ' ' + escapeCli(c.doc_identidad || '') +
                    ' · ' + escapeCli(c.categoria || c.tipo_cliente || '') +
                    ' · Zona: ' + escapeCli(c.codigo_zona || '-') +
                    (c.descripcion_zona ? ' ' + escapeCli(c.descripcion_zona) : '') +
                    (c.linea_credito != null ? ' · Crédito: ' + c.linea_credito : '') +
                    '</div></div>';
            }).join('');
        }


        function cerrarHeaderMenu() {
            const btn = document.getElementById('headerMenuBtn');
            const dd = document.getElementById('headerMenuDropdown');
            if (dd) dd.hidden = true;
            if (btn) btn.setAttribute('aria-expanded', 'false');
        }
        function toggleHeaderMenu() {
            const btn = document.getElementById('headerMenuBtn');
            const dd = document.getElementById('headerMenuDropdown');
            if (!dd || !btn) return;
            const open = dd.hidden;
            dd.hidden = !open;
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        }

        function init() {
            cargarTema();
            if (themeToggleBtn) {
                themeToggleBtn.addEventListener('click', alternarTema);
            }
            initCardsPlegables();

            // Menú admin del header (solo opciones administrativas)
            const headerMenuBtn = document.getElementById('headerMenuBtn');
            if (headerMenuBtn) {
                headerMenuBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    toggleHeaderMenu();
                });
            }
            const headerMenuDropdown = document.getElementById('headerMenuDropdown');
            if (headerMenuDropdown) {
                headerMenuDropdown.addEventListener('click', function (e) {
                    const item = e.target.closest('[data-admin-goto]');
                    if (!item) return;
                    e.preventDefault();
                    const tab = item.getAttribute('data-admin-goto') || 'subir';
                    abrirAdminEnSeccion(tab);
                });
            }
            document.addEventListener('click', function (e) {
                const wrap = document.getElementById('headerMenuWrap');
                if (!wrap) return;
                if (!wrap.contains(e.target)) cerrarHeaderMenu();
            });
            document.addEventListener('keydown', function (e) {
                if (e.key !== 'Escape') return;
                cerrarHeaderMenu();
                const ov = document.getElementById('adminOverlay');
                if (ov && ov.classList.contains('visible') && typeof cerrarPanelAdmin === 'function') {
                    cerrarPanelAdmin();
                }
            });

            poblarSelectDia();
            poblarSelectMes();
            poblarYearTabs();
            resetVencimientoAHoy();

            loadInventario();
            renderInventario();
            loadPedido();
            loadFromGoogleSheets();

            const adminCloseBtn = document.getElementById('adminCloseBtn');
            const adminCancelBtn = document.getElementById('adminCancelBtn');
            if (adminCloseBtn) adminCloseBtn.addEventListener('click', cerrarPanelAdmin);
            if (adminCancelBtn) adminCancelBtn.addEventListener('click', cerrarPanelAdmin);

            // Pestañas admin (también hay delegación global más abajo)

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
            const adminCatalogInput = document.getElementById('adminCatalogInput');
            if (adminCatalogInput) {
                let tCat = null;
                adminCatalogInput.addEventListener('input', function () {
                    clearTimeout(tCat);
                    const v = this.value;
                    tCat = setTimeout(function () { buscarCatalogoAdmin(v); }, 200);
                });
            }
            const importClientesInput = document.getElementById('importClientesInput');
            const adminClientesImportBtn = document.getElementById('adminClientesImportBtn');
            if (adminClientesImportBtn && importClientesInput) {
                adminClientesImportBtn.addEventListener('click', function () {
                    importClientesInput.click();
                });
            }
            if (importClientesInput) {
                importClientesInput.addEventListener('change', function () {
                    const f = this.files && this.files[0];
                    if (f) importarClientesExcel(f);
                    this.value = '';
                });
            }
            const adminClienteInput = document.getElementById('adminClienteInput');
            if (adminClienteInput) {
                let tCli = null;
                adminClienteInput.addEventListener('input', function () {
                    clearTimeout(tCli);
                    const v = this.value;
                    tCli = setTimeout(function () { buscarClientesAdmin(v); }, 200);
                });
            }

            const adminCatalogSoloCero = document.getElementById('adminCatalogSoloCero');
            if (adminCatalogSoloCero) {
                adminCatalogSoloCero.addEventListener('change', function () {
                    const inp = document.getElementById('adminCatalogInput');
                    buscarCatalogoAdmin(inp ? inp.value : '');
                });
            }
            // Admin: herramienta códigos de barras / QR
            const adminBarrasInput = document.getElementById('adminBarrasInput');
            if (adminBarrasInput) {
                let tBar = null;
                adminBarrasInput.addEventListener('input', function () {
                    clearTimeout(tBar);
                    const v = this.value;
                    tBar = setTimeout(function () { buscarBarrasAdmin(v); }, 200);
                });
            }
            const adminBarrasSoloSin = document.getElementById('adminBarrasSoloSin');
            if (adminBarrasSoloSin) {
                adminBarrasSoloSin.addEventListener('change', function () {
                    const inp = document.getElementById('adminBarrasInput');
                    buscarBarrasAdmin(inp ? inp.value : '');
                });
            }
            const adminBarrasList = document.getElementById('adminBarrasList');
            if (adminBarrasList) {
                adminBarrasList.addEventListener('click', function (e) {
                    const row = e.target.closest('.admin-barras-item');
                    if (!row) return;
                    const cod = row.getAttribute('data-codigo');
                    if (cod) seleccionarProductoBarrasAdmin(cod);
                });
                adminBarrasList.addEventListener('keydown', function (e) {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    const row = e.target.closest('.admin-barras-item');
                    if (!row) return;
                    e.preventDefault();
                    const cod = row.getAttribute('data-codigo');
                    if (cod) seleccionarProductoBarrasAdmin(cod);
                });
            }
            const adminRefreshVistaBtn = document.getElementById('adminRefreshVistaBtn');
            if (adminRefreshVistaBtn) {
                adminRefreshVistaBtn.addEventListener('click', function () {
                    if (!esAdmin()) return;
                    renderVistaPreviaInventario();
                });
            }
            const adminPdfInvBtn = document.getElementById('adminPdfInvBtn');
            if (adminPdfInvBtn) {
                adminPdfInvBtn.addEventListener('click', function () {
                    if (!esAdmin()) return;
                    exportarInventarioPDF();
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
            const scanBarcodeBtn = document.getElementById('scanBarcodeBtn');
            if (scanBarcodeBtn) scanBarcodeBtn.addEventListener('click', function () { abrirEscaner('buscar'); });
            const scanCloseBtn = document.getElementById('scanCloseBtn');
            const scanCancelBtn = document.getElementById('scanCancelBtn');
            if (scanCloseBtn) scanCloseBtn.addEventListener('click', detenerEscaner);
            if (scanCancelBtn) scanCancelBtn.addEventListener('click', detenerEscaner);
            const btnVincularBarras = document.getElementById('btnVincularBarras');
            if (btnVincularBarras) btnVincularBarras.addEventListener('click', function () {
                if (!esAdmin()) return;
                abrirEscaner('vincular');
            });
            // Cámara en la tarjeta del producto (zona marcada): vincular o buscar
            const btnScanProducto = document.getElementById('btnScanProducto');
            if (btnScanProducto) btnScanProducto.addEventListener('click', function () {
                if (!esAdmin()) return;
                if (selectedIndex >= 0 && selectedIndex < filteredData.length) {
                    abrirEscaner('vincular');
                } else {
                    abrirEscaner('buscar');
                }
            });

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
            if (typeof window.cambiarTabAdmin === 'function') window.cambiarTabAdmin(tabId);
        }

        // Clic / toque en menú admin (delega a cambiarTabAdmin + hash)
        document.addEventListener('click', function (e) {
            const btn = e.target && e.target.closest && e.target.closest('.admin-nav-btn');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            const tab = btn.getAttribute('data-admin-tab');
            if (tab) {
                // Actualiza la URL (#/admin/barras) y cambia la vista
                if (typeof navegarHash === 'function') navegarHash('#/admin/' + tab);
                else if (typeof window.cambiarTabAdmin === 'function') window.cambiarTabAdmin(tab);
            }
        }, true);

        // ============================================================
        // HASH ROUTING — navegación en la misma ventana (sin React)
        // Ejemplos:
        //   #/              → inventario (pantalla principal)
        //   #/admin         → administración (pestaña por defecto)
        //   #/admin/barras  → sección Barras / QR
        // El botón "atrás" del navegador también funciona.
        // ============================================================
        const ADMIN_TABS = ['subir', 'catalogo', 'barras', 'descargas', 'vista', 'clientes', 'sesiones'];
        let _hashNavSilent = false;

        function parseHashRuta() {
            var raw = String(location.hash || '').replace(/^#/, '').trim();
            if (!raw || raw === '/') return { vista: 'app', tab: null };
            var parts = raw.replace(/^\//, '').split('/').filter(Boolean);
            if (parts[0] === 'admin') {
                var tab = parts[1] && ADMIN_TABS.indexOf(parts[1]) >= 0 ? parts[1] : 'subir';
                return { vista: 'admin', tab: tab };
            }
            return { vista: 'app', tab: null };
        }

        function navegarHash(hash, replace) {
            var h = hash || '#/';
            if (!h.startsWith('#')) h = '#' + h;
            var current = location.hash || '#/';
            if (current === h || current === h + '/') {
                aplicarRutaHash();
                return;
            }
            _hashNavSilent = true;
            if (replace) {
                try { history.replaceState(null, '', h); } catch (e) { location.hash = h; }
            } else {
                location.hash = h;
            }
            aplicarRutaHash();
            setTimeout(function () { _hashNavSilent = false; }, 50);
        }

        function aplicarRutaHash() {
            var ruta = parseHashRuta();
            if (ruta.vista === 'admin') {
                if (typeof esAdmin === 'function' && !esAdmin()) {
                    showToast('Solo el administrador puede entrar aquí.', 'error');
                    navegarHash('#/', true);
                    return;
                }
                // Abrir panel sin volver a escribir el hash
                const ov = document.getElementById('adminOverlay');
                if (ov && !ov.classList.contains('visible')) {
                    if (typeof abrirPanelAdmin === 'function') {
                        // abrirPanelAdmin también llama cambiarTabAdmin
                        _abriendoDesdeHash = true;
                        abrirPanelAdmin(ruta.tab);
                        _abriendoDesdeHash = false;
                    }
                } else if (typeof window.cambiarTabAdmin === 'function') {
                    window.cambiarTabAdmin(ruta.tab);
                }
            } else {
                if (typeof cerrarPanelAdmin === 'function') {
                    _cerrandoDesdeHash = true;
                    cerrarPanelAdmin();
                    _cerrandoDesdeHash = false;
                }
            }
        }

        var _abriendoDesdeHash = false;
        var _cerrandoDesdeHash = false;

        window.addEventListener('hashchange', function () {
            if (_hashNavSilent) return;
            aplicarRutaHash();
        });

        // ============================================================
        // INICIO DE SESIÓN — Supabase Auth
        // ============================================================
        // Login con auth.signInWithPassword (JWT). El rol se lee de la
        // tabla public.perfiles (no de app_usuarios). Ejecuta primero
        // MIGRACION_SUPABASE_AUTH.sql y crea usuarios en Authentication.
        // ============================================================

        const SESSION_KEY = 'iem_sesion_activa';
        const AUTH_EMAIL_DOMAIN = 'iem.local'; // luis → luis@iem.local
        const LOGIN_MAX_INTENTOS = 5;
        const LOGIN_BLOQUEO_MS = 60 * 1000;
        let loginIntentos = 0;
        let loginBloqueoHasta = 0;

        const loginOverlay = document.getElementById('loginOverlay');
        const loginUsuario = document.getElementById('loginUsuario');
        const loginClave = document.getElementById('loginClave');
        const loginError = document.getElementById('loginError');
        const loginBtn = document.getElementById('loginBtn');
        const appContainer = document.getElementById('appContainer');
        const usuarioBadge = document.getElementById('usuarioBadge');
        const usuarioBadgeTexto = document.getElementById('usuarioBadgeTexto');
        let appIniciado = false;

        let usuarioActual = '';
        let rolUsuario = '';

        function mismoDia(ts) {
            const a = new Date(ts);
            const b = new Date();
            return a.getFullYear() === b.getFullYear() &&
                   a.getMonth() === b.getMonth() &&
                   a.getDate() === b.getDate();
        }

        function usuarioAEmail(usuario) {
            const u = String(usuario || '').trim().toLowerCase();
            if (!u) return '';
            if (u.includes('@')) return u;
            return u + '@' + AUTH_EMAIL_DOMAIN;
        }

        function guardarMetaSesion(usuario, rol) {
            try {
                localStorage.setItem(SESSION_KEY, JSON.stringify({
                    ts: Date.now(),
                    usuario: usuario,
                    rol: rol,
                    deviceId: deviceId
                }));
            } catch (e) {}
        }

        function leerMetaSesion() {
            try {
                const raw = localStorage.getItem(SESSION_KEY);
                if (!raw) return null;
                const data = JSON.parse(raw);
                if (!data || !data.ts) return null;
                if (!mismoDia(data.ts)) return null;
                if (data.deviceId && data.deviceId !== deviceId) return null;
                return data;
            } catch (e) {
                return null;
            }
        }

        function esAdmin() {
            return String(rolUsuario || '').toLowerCase() === 'admin';
        }

        function actualizarUIPorRol() {
            const es = esAdmin();
            document.body.classList.toggle('es-admin', !!es);
            const menuWrap = document.getElementById('headerMenuWrap');
            if (menuWrap) menuWrap.style.display = es ? '' : 'none';
            ['exportDiffBtn', 'clearDiffBtn', 'guardarDriveBtn', 'exportPedidoBtn'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = es ? '' : 'none';
            });
            const scanBtn = document.getElementById('scanBarcodeBtn');
            if (scanBtn) scanBtn.style.setProperty('display', es ? 'inline-flex' : 'none', 'important');
            const vincRow = document.getElementById('vincularBarrasRow');
            if (vincRow && !es) vincRow.style.display = 'none';
            const scanProd = document.getElementById('btnScanProducto');
            if (scanProd) scanProd.style.display = es ? '' : 'none';
            if (typeof actualizarFilaVincular === 'function') actualizarFilaVincular();
        }

        function abrirAdminEnSeccion(tabId) {
            if (!esAdmin()) {
                showToast('Solo el administrador puede abrir este panel.', 'error');
                return;
            }
            var tab = tabId || 'subir';
            if (typeof navegarHash === 'function') {
                navegarHash('#/admin/' + tab);
            } else {
                abrirPanelAdmin(tab);
            }
            if (typeof cerrarHeaderMenu === 'function') cerrarHeaderMenu();
        }

        let adminSelectedFile = null;

        function abrirPanelAdmin(tabId) {
            if (!esAdmin()) {
                showToast('Solo el administrador puede abrir este panel.', 'error');
                return;
            }
            const ov = document.getElementById('adminOverlay');
            if (!ov) return;
            ov.classList.add('visible');
            ov.setAttribute('aria-hidden', 'false');
            document.body.classList.add('admin-open');
            document.body.style.overflow = 'hidden';
            adminSelectedFile = null;
            const nameEl = document.getElementById('adminFileName');
            const statusEl = document.getElementById('adminStatus');
            const importBtn = document.getElementById('adminImportBtn');
            if (nameEl) nameEl.textContent = '';
            if (statusEl) statusEl.textContent = '';
            if (importBtn) importBtn.disabled = true;
            const tab = tabId || 'subir';
            if (typeof window.cambiarTabAdmin === 'function') window.cambiarTabAdmin(tab);
            else if (typeof cargarSesionesActivas === 'function') cargarSesionesActivas();
            const body = ov.querySelector('.admin-panel-body');
            if (body) body.scrollTop = 0;
            // Hash en la misma ventana: #/admin/subir
            if (!_abriendoDesdeHash && typeof navegarHash === 'function') {
                var want = '#/admin/' + tab;
                if (location.hash.replace(/\/$/, '') !== want) {
                    navegarHash(want, true);
                }
            }
        }

        function cerrarPanelAdmin() {
            const ov = document.getElementById('adminOverlay');
            if (!ov) return;
            ov.classList.remove('visible');
            ov.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('admin-open');
            document.body.style.overflow = '';
            adminSelectedFile = null;
            const input = document.getElementById('importExcelInput');
            if (input) input.value = '';
            if (!_cerrandoDesdeHash && typeof navegarHash === 'function') {
                if (/^#\/admin/.test(location.hash || '')) {
                    navegarHash('#/', true);
                }
            }
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
            // Si la URL ya trae #/admin/..., abrir esa sección
            if (typeof aplicarRutaHash === 'function') {
                setTimeout(aplicarRutaHash, 50);
            }
        }

        function mostrarLogin() {
            appContainer.classList.add('oculto');
            loginOverlay.classList.remove('hidden');
            if (loginUsuario) loginUsuario.value = '';
            if (loginClave) loginClave.value = '';
            if (loginError) loginError.classList.add('hidden');
            if (loginUsuario) loginUsuario.focus();
        }

        async function cargarPerfil(userId, emailFallback) {
            try {
                const { data, error } = await supabaseClient
                    .from('perfiles')
                    .select('usuario, nombre, rol, activo')
                    .eq('id', userId)
                    .maybeSingle();
                if (error) throw error;
                if (data) {
                    if (data.activo === false) {
                        return { ok: false, motivo: 'Usuario desactivado.' };
                    }
                    return {
                        ok: true,
                        usuario: data.usuario || split_part_email(emailFallback),
                        rol: String(data.rol || 'usuario').toLowerCase() === 'admin' ? 'admin' : 'usuario'
                    };
                }
            } catch (e) {
                console.warn('No se pudo leer perfiles (¿ejecutaste el SQL de migración?)', e);
            }
            // Fallback: sin tabla perfiles → usuario del email, rol usuario
            // (excepto si el email empieza por luis@ → admin de emergencia)
            const u = split_part_email(emailFallback);
            const rol = (u === 'luis') ? 'admin' : 'usuario';
            return { ok: true, usuario: u, rol: rol };
        }

        function split_part_email(email) {
            return String(email || '').split('@')[0].toLowerCase() || 'usuario';
        }

        async function aplicarSesionAuth(session) {
            if (!session || !session.user) return false;
            const perfil = await cargarPerfil(session.user.id, session.user.email);
            if (!perfil.ok) {
                try { await supabaseClient.auth.signOut(); } catch (e) {}
                try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
                if (loginError) {
                    loginError.textContent = perfil.motivo || 'Usuario no autorizado.';
                    loginError.classList.remove('hidden');
                }
                return false;
            }
            usuarioActual = perfil.usuario;
            rolUsuario = perfil.rol;
            guardarMetaSesion(usuarioActual, rolUsuario);
            mostrarApp();
            return true;
        }

        function cerrarSesion() {
            confirmarAccion('¿Cerrar sesión?', 'Salir', 'primary').then(async ok => {
                if (!ok) return;
                await borrarSesionActiva();
                try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
                try { await supabaseClient.auth.signOut(); } catch (e) {}
                usuarioActual = '';
                rolUsuario = '';
                mostrarLogin();
            });
        }

        async function intentarLogin() {
            const ahora = Date.now();
            if (ahora < loginBloqueoHasta) {
                const seg = Math.ceil((loginBloqueoHasta - ahora) / 1000);
                loginError.textContent = 'Demasiados intentos. Espere ' + seg + 's.';
                loginError.classList.remove('hidden');
                return;
            }

            const usuario = (loginUsuario.value || '').trim().toLowerCase().slice(0, 64);
            const clave = (loginClave.value || '').slice(0, 128);
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
                const email = usuarioAEmail(usuario);
                const { data, error } = await supabaseClient.auth.signInWithPassword({
                    email: email,
                    password: clave
                });
                if (error) throw error;
                if (!data || !data.session) throw new Error('Sin sesión');

                loginIntentos = 0;
                loginClave.value = '';
                const ok = await aplicarSesionAuth(data.session);
                if (!ok) {
                    loginClave.focus();
                }
            } catch (e) {
                console.error('Login error:', e);
                loginIntentos += 1;
                if (loginIntentos >= LOGIN_MAX_INTENTOS) {
                    loginBloqueoHasta = Date.now() + LOGIN_BLOQUEO_MS;
                    loginIntentos = 0;
                    loginError.textContent = 'Demasiados intentos. Espere 60 segundos.';
                } else {
                    const msg = String((e && e.message) || e || '');
                    if (/invalid login|invalid credentials|email not confirmed/i.test(msg)) {
                        loginError.textContent = 'Usuario o clave incorrectos.';
                    } else if (/failed to fetch|network/i.test(msg)) {
                        loginError.textContent = 'Sin conexión. Intente de nuevo.';
                    } else {
                        loginError.textContent = 'No se pudo iniciar sesión. Revise usuario/clave o que el usuario exista en Authentication.';
                    }
                }
                loginError.classList.remove('hidden');
                loginClave.value = '';
                loginClave.focus();
            } finally {
                loginBtn.disabled = false;
                loginBtn.textContent = 'Entrar';
            }
        }

        // Solo entra al pulsar Entrar / enviar el formulario (NO auto-login por contraseña guardada)
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', function (e) {
                e.preventDefault();
                intentarLogin();
            });
        } else if (loginBtn) {
            loginBtn.addEventListener('click', intentarLogin);
        }
        loginClave.addEventListener('keyup', (e) => { if (e.key === 'Enter') intentarLogin(); });
        loginUsuario.addEventListener('keyup', (e) => { if (e.key === 'Enter') loginClave.focus(); });
        document.getElementById('logoutBtn').addEventListener('click', function () {
            if (typeof cerrarHeaderMenu === 'function') cerrarHeaderMenu();
            cerrarSesion();
        });

        // Arranque: si hay sesión Auth válida + meta del día, entrar
        (async function arrancarSesion() {
            try {
                const meta = leerMetaSesion();
                const { data: { session } } = await supabaseClient.auth.getSession();
                if (session && meta) {
                    const ok = await aplicarSesionAuth(session);
                    if (ok) return;
                }
                if (session && !meta) {
                    // Sesión Auth de otro día/dispositivo → cerrar y pedir login
                    try { await supabaseClient.auth.signOut(); } catch (e) {}
                    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
                }
            } catch (e) {
                console.warn('arrancarSesion', e);
            }
            mostrarLogin();
        })();

        // Escuchar cambios de Auth (logout en otra pestaña, etc.)
        try {
            supabaseClient.auth.onAuthStateChange(function (event, session) {
                if (event === 'SIGNED_OUT') {
                    usuarioActual = '';
                    rolUsuario = '';
                    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
                    if (appContainer && !appContainer.classList.contains('oculto')) {
                        mostrarLogin();
                    }
                }
            });
        } catch (e) {}

        // Cierre si cambió el día (meta local)
        setInterval(() => {
            if (!appContainer.classList.contains('oculto') && !leerMetaSesion()) {
                borrarSesionActiva();
                try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
                try { supabaseClient.auth.signOut(); } catch (e) {}
                usuarioActual = '';
                rolUsuario = '';
                mostrarLogin();
            }
        }, 60000);

        // Cierre por inactividad (20 min)
        const INACTIVIDAD_MS = 20 * 60000;
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
                try { supabaseClient.auth.signOut(); } catch (e) {}
                usuarioActual = '';
                rolUsuario = '';
                mostrarLogin();
            }
        }, 60000);
    })();
