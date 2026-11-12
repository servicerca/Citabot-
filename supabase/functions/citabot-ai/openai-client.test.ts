import { createOpenAiResponse } from "./openai-client.ts";

const noWait = async (_milliseconds: number) => {};

Deno.test("no reintenta un 429 para evitar llamadas facturables no reservadas", async () => {
  let calls = 0;
  const result = await createOpenAiResponse("test-key", { model: "gpt-5-mini" }, {
    wait: noWait,
    fetcher: async () => {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { code: "rate_limit", type: "requests" } }), {
          status: 429,
        });
      }
      return new Response(JSON.stringify({ output_text: "Respuesta de prueba" }), {
        status: 200,
        headers: { "x-request-id": "req_test-123" },
      });
    },
  });

  if (result.ok || result.status !== 429 || result.attempts !== 1 || calls !== 1) {
    throw new Error("Un 429 debe terminar tras un único intento reservado.");
  }
});

Deno.test("no reintenta un 502 sin reservar una nueva unidad de consumo", async () => {
  let calls = 0;
  const result = await createOpenAiResponse("test-key", { model: "gpt-5-mini" }, {
    wait: noWait,
    fetcher: async () => {
      calls++;
      if (calls === 1) return new Response("Bad Gateway", { status: 502 });
      return new Response(JSON.stringify({ output_text: "Respuesta recuperada" }), {
        status: 200,
      });
    },
  });

  if (result.ok || result.status !== 502 || result.attempts !== 1 || calls !== 1) {
    throw new Error("Un 502 debe terminar tras un único intento reservado.");
  }
});

Deno.test("no reintenta errores de solicitud no recuperables", async () => {
  let calls = 0;
  const result = await createOpenAiResponse("test-key", { model: "invalid-model" }, {
    wait: noWait,
    fetcher: async () => {
      calls++;
      return new Response(JSON.stringify({
        error: { code: "model_not_found", type: "invalid_request_error" },
      }), { status: 400 });
    },
  });

  if (result.ok || result.status !== 400 || result.attempts !== 1 || calls !== 1) {
    throw new Error("Los errores 4xx no recuperables deben terminar sin reintentos.");
  }
  if (result.errorCode !== "model_not_found" || result.errorType !== "invalid_request_error") {
    throw new Error("No se extrajo el diagnóstico seguro del proveedor.");
  }
});

Deno.test("clasifica fallos de red sin guardar el mensaje de la solicitud", async () => {
  let calls = 0;
  const result = await createOpenAiResponse("test-key", { input: "contenido privado" }, {
    wait: noWait,
    fetcher: async () => {
      calls++;
      throw new TypeError("network failure with private request data");
    },
  });

  if (result.ok || result.attempts !== 1 || calls !== 1 || result.failureKind !== "TypeError") {
    throw new Error("Los fallos de red deben quedar clasificados y reintentarse.");
  }
  if (JSON.stringify(result).includes("contenido privado")) {
    throw new Error("El diagnóstico no debe contener el contenido de la solicitud.");
  }
});

Deno.test("clasifica el timeout del proveedor", async () => {
  const result = await createOpenAiResponse("test-key", { model: "gpt-5-mini" }, {
    timeoutMs: 5,
    wait: noWait,
    fetcher: async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
        once: true,
      });
    }),
  });

  if (result.ok || result.failureKind !== "timeout" || result.attempts !== 1) {
    throw new Error("Los tiempos de espera deben clasificarse y reintentarse.");
  }
});
