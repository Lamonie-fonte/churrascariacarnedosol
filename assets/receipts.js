(() => {
  const LOCALE = "pt-BR";
  const TIME_ZONE = "America/Fortaleza";

  function displayName(value) {
    const text = String(value || "").trim();
    return /[a-záàâãéêíóôõúç]/u.test(text) ? text.toLocaleLowerCase(LOCALE) : text;
  }

  function phone(value) {
    const digits = String(value || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
    if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return String(value || "");
  }

  function dateTime(value) {
    return new Intl.DateTimeFormat(LOCALE, {
      timeZone: TIME_ZONE,
      dateStyle: "short",
      timeStyle: "short"
    }).format(new Date(value || Date.now()));
  }

  function fullAddress(address) {
    if (!address) return "Retirada no estabelecimento";
    const first = `${address.street || ""}, ${address.number || ""}${address.complement ? ` — ${address.complement}` : ""}`;
    const second = `${address.neighborhood || ""}, ${address.city || ""}/${address.state || ""}${address.postal_code ? ` — CEP ${address.postal_code}` : ""}`;
    return `${first}\n${second}${address.reference ? `\nReferência: ${address.reference}` : ""}`;
  }

  function mapUrl(address) {
    if (!address) return "";
    const query = [address.street, address.number, address.neighborhood, address.city, address.state, address.postal_code]
      .filter(Boolean).join(", ");
    return `https://maps.google.com/?q=${encodeURIComponent(query)}`;
  }

  function paymentLabel(order) {
    const labels = { pix: "Pix", card: "Cartão", cash: "Dinheiro" };
    let value = labels[order.payment_method] || order.payment_method || "Não informado";
    if (order.payment_method === "card" && order.payment_detail) value += order.payment_detail === "credit" ? " de crédito" : " de débito";
    if (order.payment_method === "cash" && Number(order.change_for) > 0) value += ` — troco para ${money(order.change_for)}`;
    return value;
  }

  function statusLabel(value) {
    return ({
      pending: "Pendente", confirmed: "Confirmado", preparing: "Em preparo", ready: "Pronto",
      out_for_delivery: "Saiu para entrega", completed: "Concluído", cancelled: "Cancelado"
    })[value] || value || "Pendente";
  }

  function items(order) {
    return order.order_items || order.items || [];
  }

  function whatsappText(order) {
    const lines = [
      "🔥 *NOVO PEDIDO — CHURRASCARIA CARNE DE SOL* 🔥",
      "",
      `#️⃣ *Nº do pedido:* ${order.order_number}`,
      `📅 *Feito em:* ${dateTime(order.created_at)}`,
      `📌 *Status:* ${statusLabel(order.status)}`,
      "",
      `👤 *Cliente:* ${order.customer_name || ""}`,
      `📞 *WhatsApp:* ${phone(order.phone)}`,
      ""
    ];

    if (order.order_type === "delivery" && order.address) {
      lines.push("🛵 *ENDEREÇO DE ENTREGA*", ...fullAddress(order.address).split("\n"), "", "🗺️ *Link do endereço:*", mapUrl(order.address), "");
    } else {
      lines.push("🏪 *RETIRADA NO ESTABELECIMENTO*", "");
    }

    lines.push("━━━━━━━━ ITENS DO PEDIDO ━━━━━━━━", "");
    items(order).forEach(item => {
      lines.push(`*${item.quantity} x ${displayName(item.product_name || item.name).toLocaleUpperCase(LOCALE)}*`);
      const grouped = (item.selections || item.options || []).reduce((all, selection) => {
        (all[selection.group || "Opções"] ||= []).push(selection.name);
        return all;
      }, {});
      Object.entries(grouped).forEach(([group, selections]) => {
        lines.push(`  ${displayName(group)}`);
        selections.forEach(selection => lines.push(`    • ${displayName(selection)}`));
      });
      const unit = Number(item.unit_price || 0);
      const line = Number(item.line_total ?? unit * Number(item.quantity || 1));
      lines.push(`💵 ${item.quantity} x ${money(unit)} = *${money(line)}*`);
      if (item.notes) lines.push(`❗ *OBS:* ${item.notes}`);
      lines.push("");
    });

    lines.push(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `🧾 *SUBTOTAL:* ${money(order.subtotal)}`,
      `🛵 *ENTREGA:* ${money(order.delivery_fee)}`,
      `💰 *VALOR FINAL: ${money(order.total)}*`,
      "",
      "💳 *PAGAMENTO*",
      `*${paymentLabel(order)}:* ${money(order.total)}`
    );
    if (order.notes) lines.push("", `📝 *Observações gerais:* ${order.notes}`);
    lines.push("", `🕐 *Prazo para ${order.order_type === "delivery" ? "entrega" : "retirada"}: ${order.delivery_eta_minutes || 60} min*`, "", "✅ Pedido registrado. Obrigado pela preferência!");
    return lines.join("\n");
  }

  function whatsappUrl(order, destination) {
    return `https://wa.me/${String(destination || "").replace(/\D/g, "")}?text=${encodeURIComponent(whatsappText(order))}`;
  }

  async function imageData(url) {
    return new Promise(resolve => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          canvas.getContext("2d").drawImage(image, 0, 0);
          resolve(canvas.toDataURL("image/jpeg", .9));
        } catch { resolve(null); }
      };
      image.onerror = () => resolve(null);
      image.src = url;
    });
  }

  async function downloadPdf(order, settings = {}) {
    const JsPdf = window.jspdf?.jsPDF;
    if (!JsPdf) throw new Error("O gerador de PDF ainda não carregou. Aguarde alguns segundos e tente novamente.");
    const doc = new JsPdf({ unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const left = 18;
    const right = pageWidth - 18;
    let y = 18;

    function frame() {
      doc.setDrawColor(255, 107, 26);
      doc.setLineWidth(.7);
      doc.roundedRect(8, 8, pageWidth - 16, pageHeight - 16, 3, 3);
      doc.setDrawColor(30, 20, 16);
      doc.setLineWidth(.15);
      doc.roundedRect(11, 11, pageWidth - 22, pageHeight - 22, 2, 2);
    }
    function nextPage(required = 12) {
      if (y + required < pageHeight - 20) return;
      doc.addPage(); frame(); y = 18;
    }
    function line(text, options = {}) {
      const { bold = false, size = 10, color = [35, 27, 23], gap = 5.4, indent = 0 } = options;
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      doc.setTextColor(...color);
      const wrapped = doc.splitTextToSize(String(text || ""), right - left - indent);
      nextPage(wrapped.length * gap + 2);
      doc.text(wrapped, left + indent, y);
      y += wrapped.length * gap;
    }

    frame();
    const logo = await imageData(settings.logo_url || "/assets/logo-carne-de-sol.jpg");
    if (logo) doc.addImage(logo, "JPEG", left, y, 25, 25);
    doc.setTextColor(255, 90, 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("CHURRASCARIA CARNE DE SOL", logo ? 48 : left, y + 9);
    doc.setTextColor(45, 34, 28);
    doc.setFontSize(10);
    doc.text("Comprovante do pedido", logo ? 48 : left, y + 16);
    y += 34;
    doc.setDrawColor(225, 205, 190); doc.line(left, y, right, y); y += 8;

    line(`PEDIDO Nº ${order.order_number}`, { bold: true, size: 16, color: [255, 90, 20], gap: 7 });
    line(`Feito em ${dateTime(order.created_at)}  •  ${statusLabel(order.status)}`, { bold: true });
    y += 2;
    line(`Cliente: ${order.customer_name || ""}`, { bold: true });
    line(`WhatsApp: ${phone(order.phone)}`);
    if (order.email) line(`E-mail: ${order.email}`);
    y += 3;
    line(order.order_type === "delivery" ? "ENDEREÇO DE ENTREGA" : "RETIRADA NO ESTABELECIMENTO", { bold: true, color: [255, 90, 20] });
    fullAddress(order.address).split("\n").forEach(value => line(value));
    if (order.address) line(`Mapa: ${mapUrl(order.address)}`, { size: 8, color: [70, 90, 130] });
    y += 4;
    line("ITENS DO PEDIDO", { bold: true, color: [255, 90, 20] });
    items(order).forEach(item => {
      nextPage(18);
      line(`${item.quantity} x ${displayName(item.product_name || item.name).toLocaleUpperCase(LOCALE)}`, { bold: true });
      (item.selections || item.options || []).forEach(selection => line(`• ${displayName(selection.group || "Opção")}: ${displayName(selection.name)}`, { size: 9, indent: 4, gap: 4.7 }));
      if (item.notes) line(`Observação: ${item.notes}`, { bold: true, size: 9, indent: 4 });
      line(`${item.quantity} x ${money(item.unit_price)} = ${money(item.line_total ?? Number(item.unit_price || 0) * Number(item.quantity || 1))}`, { bold: true, indent: 4 });
      y += 2;
    });
    nextPage(38); doc.setDrawColor(225, 205, 190); doc.line(left, y, right, y); y += 7;
    line(`Subtotal: ${money(order.subtotal)}`, { bold: true });
    line(`Entrega: ${money(order.delivery_fee)}`, { bold: true });
    line(`VALOR FINAL: ${money(order.total)}`, { bold: true, size: 15, color: [255, 90, 20], gap: 7 });
    line(`Pagamento: ${paymentLabel(order)}`);
    line(`Prazo estimado: ${order.delivery_eta_minutes || 60} minutos`);
    if (order.notes) line(`Observações gerais: ${order.notes}`);
    y += 6;
    line("Obrigado pela preferência!", { bold: true, size: 12, color: [255, 90, 20] });
    doc.save(`pedido-${order.order_number}-carne-de-sol.pdf`);
  }

  window.OrderTools = Object.freeze({ displayName, phone, dateTime, fullAddress, mapUrl, paymentLabel, statusLabel, whatsappText, whatsappUrl, downloadPdf });
})();
