// Configuración pública de Supabase (visible en el cliente)
// La seguridad real está en RLS de Supabase, no en ocultar esta clave.
window.IEM_CONFIG = {
  SUPABASE_URL: 'https://rgqlkeuzzqrmmgxtmren.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJncWxrZXV6enFybW1neHRtcmVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NDE5NzMsImV4cCI6MjEwMjIxNzk3M30.P-Y577WPIgckmqCcy77rm-R55TDj6McQFvGayd0_yq0',
  // Opcional: forzar admin por nombre de usuario (además de perfiles.rol = admin)
  // ADMIN_USUARIOS: ['luis', 'andric']
};
window.SUPABASE_URL = window.IEM_CONFIG.SUPABASE_URL;
window.SUPABASE_ANON_KEY = window.IEM_CONFIG.SUPABASE_ANON_KEY;
