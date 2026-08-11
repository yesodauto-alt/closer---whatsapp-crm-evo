import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/evolution-api.ts'
import {
  buildChannelInstanceName,
  createServiceClient,
  ensureFullHistoryConfigured,
  ensureInstanceExists,
  ensureWebhookConfigured,
  getChannelForOrganization,
  resolveIntegration,
} from '../_shared/integration.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const requestedChannelId = String(body?.channelId ?? '').trim() || null

    let { user, integration, tenantUserId, organizationId } = await resolveIntegration(
      req,
      requestedChannelId ? { channelId: requestedChannelId } : {},
    )
    if (!user || !tenantUserId) return errorResponse('Unauthorized', 401)

    const db = createServiceClient()
    let channelId = requestedChannelId || integration?.channel_id || null

    if (requestedChannelId) {
      if (!organizationId) return errorResponse('Organization not found for channel', 400)
      const channel = await getChannelForOrganization(organizationId, requestedChannelId)
      if (!channel) return errorResponse('Channel not found', 404)
      if (channel.type !== 'whatsapp' || channel.provider !== 'evolution') {
        return errorResponse('Channel is not an Evolution WhatsApp channel', 400)
      }

      if (!integration) {
        const instanceName = buildChannelInstanceName(requestedChannelId)
        const { data: createdIntegration, error: insertError } = await db
          .from('user_integrations')
          .insert({
            user_id: tenantUserId,
            channel_id: requestedChannelId,
            provider: 'evolution',
            instance_name: instanceName,
            status: 'DISCONNECTED',
            is_primary: false,
            is_setup_completed: false,
            is_webhook_enabled: false,
          })
          .select()
          .single()
        if (insertError) return errorResponse(insertError.message, 500)
        integration = createdIntegration
      }
    } else if (!integration) {
      if (!organizationId) return errorResponse('Organization not found', 400)

      const { data: primaryChannel, error: channelError } = await db
        .from('channels')
        .insert({
          organization_id: organizationId,
          name: 'WhatsApp principal',
          type: 'whatsapp',
          provider: 'evolution',
          status: 'DISCONNECTED',
          is_active: true,
          created_by: user.id,
        })
        .select()
        .single()
      if (channelError) return errorResponse(channelError.message, 500)

      const { data: createdIntegration, error: integrationError } = await db
        .from('user_integrations')
        .insert({
          user_id: tenantUserId,
          channel_id: primaryChannel.id,
          provider: 'evolution',
          instance_name: tenantUserId,
          status: 'DISCONNECTED',
          is_primary: true,
          is_setup_completed: false,
          is_webhook_enabled: false,
        })
        .select()
        .single()
      if (integrationError) return errorResponse(integrationError.message, 500)

      integration = createdIntegration
      channelId = primaryChannel.id
    }

    if (!integration) return errorResponse('Integration could not be resolved', 500)
    const instanceName = integration.instance_name || buildChannelInstanceName(channelId || integration.id)

    const ensured = await ensureInstanceExists(instanceName)
    if (ensured.error) return errorResponse(ensured.error, ensured.status)

    const history = await ensureFullHistoryConfigured(instanceName)
    if (!history.configured) {
      return errorResponse(history.error || 'Full history sync could not be enabled', history.status || 502)
    }

    const webhook = await ensureWebhookConfigured(instanceName)
    if (!webhook.configured) {
      return errorResponse(webhook.error || 'Evolution webhook could not be configured', webhook.status || 502)
    }

    const now = new Date().toISOString()
    const { error: integrationUpdateError } = await db
      .from('user_integrations')
      .update({
        instance_name: instanceName,
        status: 'CONNECTING',
        is_setup_completed: true,
        is_webhook_enabled: true,
        updated_at: now,
      })
      .eq('id', integration.id)
    if (integrationUpdateError) return errorResponse(integrationUpdateError.message, 500)

    if (channelId) {
      await db
        .from('channels')
        .update({ status: 'CONNECTING', updated_at: now })
        .eq('id', channelId)
    }

    return jsonResponse({
      success: true,
      integrationId: integration.id,
      channelId,
      instanceName,
      created: ensured.created,
      data: ensured.data,
      fullHistoryConfigured: history.configured,
      fullHistoryChanged: history.changed,
      webhookConfigured: true,
    })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500)
  }
})
