// QA E2E: flujo de sala + votación con 3 usuarios simultáneos (TestAlfa, TestBeta, TestGamma).
// Requiere la devDependency "playwright" (npm install) y, la primera vez,
// `npx playwright install chromium`.
//
// Uso:
//   node qa/three-user-flow.js [URL_BASE]
// Por defecto corre contra https://miqueasdrovetta.github.io/chat-de-voz/
//
// Importante: usa la base de datos real de producción. Si la sala usada por el
// test queda con usuarios "colgados" tras una corrida abortada a mitad de camino
// (p. ej. el proceso se mata a la fuerza), puede hacer falta limpiar
// manualmente el nodo `rooms` correspondiente desde la consola de Firebase.

const { chromium } = require('playwright');

const BASE_URL = process.argv[2] || 'https://miqueasdrovetta.github.io/chat-de-voz/';
const VOTE_DURATION_MS = 20_000;

const results = []; // { step, ok, detail }
function record(step, ok, detail) {
    results.push({ step, ok, detail });
    console.log(`${ok ? '✅ PASS' : '❌ FAIL'} — ${step}${detail ? ' :: ' + detail : ''}`);
}

function roomIdFromUrl(url) {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean); // ["chat-de-voz", "<roomId>"]
    return parts[parts.length - 1];
}

async function ownUsername(page) {
    // La tarjeta propia se marca con la etiqueta "Tú"; el username está en el <h6> de esa Card.
    const card = page.locator('div.MuiCard-root', { hasText: 'Tú' }).first();
    await card.waitFor({ state: 'visible', timeout: 15000 });
    return (await card.locator('h6').first().textContent())?.trim();
}

function voteButtonLocator(page) {
    return page.locator('button').filter({ hasText: /Votaci[oó]n|nfriamiento/i }).first();
}

async function cardFor(page, username) {
    const card = page.locator('div.MuiCard-root', { hasText: username }).first();
    await card.waitFor({ state: 'visible', timeout: 15000 });
    return card;
}

// MUI sólo agrega data-testid a los íconos en modo desarrollo; en el build de
// producción (el que corre en GitHub Pages) ese atributo no existe. El Tooltip
// sí clona su hijo con un aria-label igual al `title`, así que ese es el
// selector confiable contra el sitio real desplegado.
function expelIconIn(card, username) {
    return card.locator(`[aria-label="Votar para expulsar a ${username}"]`);
}

async function join(page, baseUsername) {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const input = page.getByLabel('Tu nombre de usuario');
    await input.waitFor({ state: 'visible', timeout: 15000 });
    await input.fill(baseUsername);
    await page.getByRole('button', { name: 'Unirse a la Sala' }).click();
    await page.waitForURL((u) => /\/chat-de-voz\/.+/.test(u.pathname) && u.pathname !== '/chat-de-voz/', { timeout: 20000 });
    await page.getByText('Sala:').waitFor({ state: 'visible', timeout: 15000 });
    const roomId = roomIdFromUrl(page.url());
    const fullUsername = await ownUsername(page);
    return { roomId, fullUsername };
}

(async () => {
    const browser = await chromium.launch({
        args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    });

    const makePage = async (label) => {
        const context = await browser.newContext();
        await context.grantPermissions(['microphone']);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('dialog', (d) => d.dismiss().catch(() => {}));
        page.__label = label;
        page.__errors = errors;
        return page;
    };

    const alfa = await makePage('TestAlfa');
    const beta = await makePage('TestBeta');
    const gamma = await makePage('TestGamma');

    try {
        // ---------- PASO 1: ingreso y asignación de sala ----------
        const a = await join(alfa, 'TestAlfa');
        record('1.1 TestAlfa ingresa y se le asigna una sala', !!a.roomId, `room=${a.roomId} username=${a.fullUsername}`);
        record('1.1b Formato de sufijo de 4 caracteres', /^TestAlfa-\w{4}$/.test(a.fullUsername || ''), a.fullUsername);

        const b = await join(beta, 'TestBeta');
        record('1.2 TestBeta ingresa', !!b.roomId, `room=${b.roomId} username=${b.fullUsername}`);
        record('1.3 TestBeta cae en la MISMA sala que TestAlfa', a.roomId === b.roomId, `${a.roomId} vs ${b.roomId}`);

        await alfa.waitForTimeout(1500); // deja propagar la actualización de Firebase al resto de clientes
        const alfaBtn2 = voteButtonLocator(alfa);
        const betaBtn2 = voteButtonLocator(beta);
        record('1.4 Botón "Iniciar Votación" deshabilitado en TestAlfa (2 usuarios)', await alfaBtn2.isDisabled());
        record('1.4b Botón "Iniciar Votación" deshabilitado en TestBeta (2 usuarios)', await betaBtn2.isDisabled());

        // ---------- PASO 2: activación con el 3er usuario ----------
        const g = await join(gamma, 'TestGamma');
        record('2.1 TestGamma ingresa a la MISMA sala', g.roomId === a.roomId, `${g.roomId} vs ${a.roomId}`);

        for (const p of [alfa, beta, gamma]) {
            await p.getByText('3 de 9 participantes.').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
        }
        const countTexts = await Promise.all([alfa, beta, gamma].map((p) => p.getByText(/de 9 participantes\./).textContent().catch(() => null)));
        record('2.1b Los 3 clientes ven "3 de 9 participantes."', countTexts.every((t) => t && t.startsWith('3 ')), countTexts.join(' | '));

        await Promise.all([alfa, beta, gamma].map((p) => p.waitForTimeout(500)));
        const enabledFlags = await Promise.all([alfa, beta, gamma].map((p) => voteButtonLocator(p).isDisabled().then((d) => !d)));
        record('2.2 Botón "Iniciar Votación" se HABILITA en los 3 clientes al llegar al 3er usuario', enabledFlags.every(Boolean), JSON.stringify(enabledFlags));

        // ---------- PASO 3: votación anónima ----------
        // De acá en más corremos contra el reloj real de los 20s de la ronda (latencia
        // de red real contra GitHub Pages + Firebase, no localhost): cero esperas no
        // esenciales entre iniciar la votación y emitir los votos. Las tarjetas de los
        // 3 participantes ya existen desde antes, así que estos lookups son casi
        // instantáneos; lo único nuevo que debe aparecer es el ícono de expulsión.
        await voteButtonLocator(alfa).click();

        const [betaCardOnAlfa, betaCardOnGamma, betaCardOnBeta] = await Promise.all([
            cardFor(alfa, b.fullUsername),
            cardFor(gamma, b.fullUsername),
            cardFor(beta, b.fullUsername),
        ]);

        await Promise.all([
            expelIconIn(betaCardOnAlfa, b.fullUsername).click(),
            expelIconIn(betaCardOnGamma, b.fullUsername).click(),
        ]);
        record('3.5a/b TestAlfa y TestGamma votan expulsar a TestBeta', true);

        // Estas lecturas ya no son time-critical: se hacen apenas después de votar,
        // mientras la ronda sigue abierta (recién la disparamos nosotros).
        const betaSelfVoteIcon = await expelIconIn(betaCardOnBeta, b.fullUsername).count();
        record('3.4 TestBeta NO puede votar por sí mismo (sin ícono de expulsión en su propia tarjeta)', betaSelfVoteIcon === 0);

        const bannerChecks = await Promise.all([alfa, beta, gamma].map((p) =>
            p.getByText(/Votaci[oó]n (en curso|para expulsar)/).isVisible().catch(() => false)
        ));
        record('3.2 Banner de votación visible en las 3 instancias', bannerChecks.every(Boolean), JSON.stringify(bannerChecks));

        const alfaCooldownText = await voteButtonLocator(alfa).textContent();
        record('3.3 TestAlfa (iniciador) entra en cooldown local de 2 min', /Enfriamiento\s+\d{2}:\d{2}/.test(alfaCooldownText || ''), alfaCooldownText);

        // ---------- PASO 4: post-expulsión y cooldown global ----------
        await alfa.waitForTimeout(VOTE_DURATION_MS + 4000); // deja cerrar la ronda de 20s + margen de red

        const kickedDialogVisible = await beta.getByText('Has sido expulsado de la sala').isVisible().catch(() => false);
        record('4.1 TestBeta ve el diálogo de expulsión', kickedDialogVisible);

        // Regresión explícita: el resto de la sala NO debe ver el modal de expulsión
        // sólo porque un tercero se fue (el chequeo debe comparar contra el propio id).
        const alfaWronglyKicked = await alfa.getByText('Has sido expulsado de la sala').isVisible().catch(() => false);
        const gammaWronglyKicked = await gamma.getByText('Has sido expulsado de la sala').isVisible().catch(() => false);
        record('4.1c TestAlfa y TestGamma NO ven el diálogo de expulsión ajeno', !alfaWronglyKicked && !gammaWronglyKicked);

        const hasSearchBtn = await beta.getByRole('button', { name: /Buscar otra sala/ }).isVisible().catch(() => false);
        const hasHomeBtn = await beta.getByRole('button', { name: /Ir al Inicio/ }).isVisible().catch(() => false);
        record('4.1b Diálogo ofrece "Buscar otra sala" / "Ir al Inicio"', hasSearchBtn && hasHomeBtn);

        const remainingTexts = await Promise.all([alfa, gamma].map((p) => p.getByText(/de 9 participantes\./).textContent().catch(() => null)));
        record('4.2 TestAlfa y TestGamma ven "2 de 9 participantes."', remainingTexts.every((t) => t && t.startsWith('2 ')), remainingTexts.join(' | '));

        const betaGoneAlfa = await alfa.locator('div.MuiCard-root', { hasText: b.fullUsername }).count();
        const betaGoneGamma = await gamma.locator('div.MuiCard-root', { hasText: b.fullUsername }).count();
        record('4.2b La tarjeta de TestBeta desaparece de las salas restantes', betaGoneAlfa === 0 && betaGoneGamma === 0);

        const alfaBtnAfter = voteButtonLocator(alfa);
        const alfaTextAfter = await alfaBtnAfter.textContent();
        record('4.3 TestAlfa sigue viendo SU cooldown personal (2 min)', /Enfriamiento\s+\d{2}:\d{2}/.test(alfaTextAfter || ''), alfaTextAfter);

        // El Tooltip de MUI clona su hijo con un aria-label igual al `title`; leerlo
        // directo evita el hover (que Playwright rechaza por el wrapper del Tooltip
        // interceptando el puntero) y es igual de válido como evidencia del texto real.
        const gammaBtnAfter = voteButtonLocator(gamma);
        const gammaDisabledAfter = await gammaBtnAfter.isDisabled();
        const gammaTooltip = await gammaBtnAfter.locator('xpath=..').getAttribute('aria-label').catch(() => '');
        record(
            '4.4 TestGamma bloqueado: prioriza "faltan participantes" (2<3) sobre el cooldown global',
            gammaDisabledAfter && (gammaTooltip || '').includes('al menos 3 participantes'),
            `disabled=${gammaDisabledAfter} tooltip="${gammaTooltip}"`
        );

        for (const p of [alfa, beta, gamma]) {
            await p.screenshot({ path: `${__dirname}/qa-final-${p.__label}.png` }).catch(() => {});
        }
    } catch (err) {
        console.error('EXCEPCIÓN NO MANEJADA EN EL FLUJO:', err);
        results.push({ step: 'EXCEPTION', ok: false, detail: String(err) });
    } finally {
        console.log('\n--- Errores de consola por instancia ---');
        for (const p of [alfa, beta, gamma]) {
            console.log(`${p.__label}: ${p.__errors.length} error(es)`);
            p.__errors.forEach((e) => console.log('  ', e));
        }

        const passed = results.filter((r) => r.ok).length;
        console.log(`\n=== RESUMEN: ${passed}/${results.length} validaciones OK ===`);
        results.filter((r) => !r.ok).forEach((r) => console.log(`  ❌ ${r.step} :: ${r.detail || ''}`));

        // Salida prolija: "atrás" del navegador es una navegación interna de la SPA
        // (React Router intercepta popstate), así que sí corre el cleanup del efecto
        // (removeUserFromRoom) y remueve al usuario de verdad. page.goto() en cambio
        // hace una recarga completa del documento y mata React sin correr el cleanup.
        console.log('\n--- Limpieza: saliendo de la sala de forma prolija ---');
        await Promise.all([alfa, beta, gamma].map((p) => p.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {})));
        await new Promise((resolve) => setTimeout(resolve, 3000));

        await browser.close();
        process.exit(results.every((r) => r.ok) ? 0 : 1);
    }
})();
