import './styles.css';
const form = document.getElementById('login-form') as HTMLFormElement;
form.onsubmit = async (event) => {
    event.preventDefault();
    const button = document.getElementById('submit') as HTMLButtonElement;
    const password = document.getElementById('password') as HTMLInputElement;
    const message = document.getElementById('message')!;
    button.disabled = true;
    try {
        const response = await fetch('/admin/api/login', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Request': '1',
            },
            body: JSON.stringify({
                operator: (
                    document.getElementById('operator') as HTMLInputElement
                ).value,
                password: password.value,
            }),
        });
        password.value = '';
        if (response.ok) {
            location.replace('/admin/');
            return;
        }
        message.textContent =
            response.status === 429
                ? 'Limite de tentativas. Aguarde um minuto.'
                : 'Não foi possível autenticar. Confira a credencial local.';
    } catch {
        password.value = '';
        message.textContent = 'Serviço indisponível. Tente novamente.';
    } finally {
        button.disabled = false;
    }
};
