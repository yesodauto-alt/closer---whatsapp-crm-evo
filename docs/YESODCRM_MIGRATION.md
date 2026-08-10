# Migração YesodCRM para a base Evolution

## Direção

- Origem funcional e visual: `yesodauto-alt/yesodcrm`.
- Destino operacional: `yesodauto-alt/whatsapp-crm-clone-evo`.
- Backend de destino: Supabase próprio.

## Regra principal

A interface, os módulos e as regras de negócio do YesodCRM serão adaptados para React/Vite e React Router. A integração Evolution existente no projeto de destino permanecerá preservada durante essa migração.

## Área protegida

Não alterar nesta fase:

- `supabase/functions/evolution-create-instance/`
- `supabase/functions/evolution-disconnect/`
- `supabase/functions/evolution-get-qr/`
- `supabase/functions/evolution-send-message/`
- `supabase/functions/evolution-sync-contacts/`
- `supabase/functions/evolution-sync-messages/`
- `supabase/functions/evolution-webhook/`
- `supabase/functions/_shared/`

Alterações futuras nessas pastas exigem tarefa separada, comparação de checksum e validação específica da Evolution.

## Módulos a migrar

1. Identidade visual e navegação YesodCRM.
2. Leads, contatos, pipeline, prioridades e fila SDR.
3. Conversas com janela de atendimento.
4. Equipes, atribuições e hierarquia.
5. Permissões: super admin, admin, líder e agente.
6. Múltiplos agentes OpenAI configuráveis.
7. Base de conhecimento.
8. Produtos, serviços e itens de oportunidade.
9. Mensagens agendadas.
10. Canais adicionais: e-mail e Telegram.
11. Dashboard comercial e financeiro.
12. Templates, automações, tarefas e suporte.

## OpenAI

- Provedor do MVP: OpenAI.
- Chave somente em secret de servidor (`OPENAI_API_KEY`).
- Modelos selecionáveis por agente por meio de lista autorizada.
- Opções iniciais: `gpt-4.1-mini`, `gpt-4o-mini`, `gpt-4.1` e `gpt-4o` como legado quando disponível.
- Nenhuma chave será armazenada no navegador, no GitHub ou em tabela exposta ao cliente.

## Produtos e oportunidades

O CRM terá produtos e serviços com SKU, categoria, unidade, custo, preço, moeda, status e imagem. Oportunidades poderão receber múltiplos itens, quantidades, descontos e totais, alimentando os dashboards financeiros.

## Segurança e dados

- A conta `yesod.auto@gmail.com` será a conta-raiz protegida.
- Atribuições e visibilidade por equipe serão aplicadas no banco com RLS.
- Backups, exports, documentos de clientes e secrets não serão versionados.
- Dados históricos serão importados somente após validação do schema e ensaio de restauração.

## Estratégia de entrega

1. Fundação do schema e permissões.
2. Interface YesodCRM no React/Vite.
3. Conversas usando as tabelas Evolution existentes.
4. Produtos e dashboard comercial.
5. Agendamento e canais adicionais.
6. Migração e validação dos dados históricos.
