import { recoverTypedSignature_v4 } from 'eth-sig-util'
import { ethers } from 'ethers'
import crypto from 'crypto'

/**
 * gatherResponse awaits and returns a response body as a string.
 * Use await gatherResponse(..) in an async function to get the response body
 * @param {Response} response
 */
async function gatherResponse(response) {
    const { headers } = response
    const contentType = headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
        return response.json()
    } else if (contentType.includes('application/text')) {
        return await response.text()
    } else if (contentType.includes('text/html')) {
        return await response.text()
    } else {
        return await response.text()
    }
}

/**
 *
 * @param {*} request
 * Accpets id=<tweet id>
 * Accpets account=<eth address>
 */
export async function handleVerify(request) {
    var requestHeaders = new Headers()
    requestHeaders.append('Authorization', 'Bearer ' + TWITTER_BEARER)

    var requestOptions = {
        method: 'GET',
        headers: requestHeaders,
        redirect: 'follow',
    }

    const init = {
        headers: { 'content-type': 'application/json' },
    }
    // get tweet id
    const { searchParams } = new URL(request.url)
    let tweetID = searchParams.get('id')
    let account = searchParams.get('account')

    let formattedAccount
    try {
        formattedAccount = ethers.utils.getAddress(account)
    } catch (e) {
        // invalid address
        const response = new Response('Invalid address', {
            status: 400,
        })
        response.headers.set('Access-Control-Allow-Origin', '*')
        response.headers.append('Vary', 'Origin')
        return response
    }

    // get tweet data from twitter api
    const twitterURL = `https://api.twitter.com/2/tweets?ids=${tweetID}&expansions=author_id&user.fields=username`
    requestOptions.headers.set('Origin', new URL(twitterURL).origin)
    const twitterRes = await fetch(twitterURL, requestOptions)

    // parse the response from Twitter
    const results = await gatherResponse(twitterRes)

    // if no tweet or author found, return error
    if (!results.data || !results.includes) {
        const response = new Response('Invalid tweet id', {
            status: 400,
        })
        response.headers.set('Access-Control-Allow-Origin', '*')
        response.headers.append('Vary', 'Origin')
        return response
    }
    // get tweet text and author from response
    const tweetContent = results.data[0].text
    const handle = results.includes.users[0].username

    // parse sig from tweet
    var reg = new RegExp('(?<=sig:).(w{10})')
    const matchedText = tweetContent.match(reg)

    // if no proper signature found, return error
    if (
        !results.data ||
        !results.includes ||
        matchedText === null ||
        matchedText === undefined
    ) {
        const response = new Response('Invalid tweet format', {
            status: 400,
        })
        response.headers.set('Access-Control-Allow-Origin', '*')
        response.headers.append('Vary', 'Origin')
        return response
    }

    // construct data for EIP712 signature recovery
    const data = {
        types: {
            EIP712Domain: [
                { name: 'name', type: 'string' },
                { name: 'version', type: 'string' },
            ],
            Permit: [{ name: 'handle', type: 'string' }],
        },
        domain: {
            name: 'Sybil Verifier',
            version: '1',
        },
        primaryType: 'Permit',
        message: {
            handle,
        },
    }
    // recover the signer based on handle
    const sig = matchedText[0]
    const signer = recoverTypedSignature_v4({
        data,
        sig,
    })

    // format with chekcsummed address
    const formattedSigner = ethers.utils.getAddress(signer)

    let response
    if (formattedAccount === formattedSigner) {
        response = new Response(handle, init, {
            status: 200,
        })
    } else {
        response = new Response('Invalid account', init, { status: 400 })
    }
    //https://example.com/api/verify?id=1324801485453119488&account=0xF45fc3edAb5060168A650A3b854E4a7290740B49

    response.headers.set('Access-Control-Allow-Origin', '*')
    response.headers.append('Vary', 'Origin')
    return response
}

//https://example.com/api/accounts?address=0xF45fc3edAb5060168A650A3b854E4a7290740B49
export async function handleAccounts(request) {
    var requestHeaders = new Headers()
    requestHeaders.append('Authorization', 'Bearer ' + TWITTER_BEARER)

    var requestOptions = {
        method: 'GET',
        headers: requestHeaders,
        redirect: 'follow',
    }

    const init = {
        headers: { 'content-type': 'application/json' },
    }

    // get the address key from request
    const { searchParams } = new URL(request.url)
    let address = searchParams.get('address')

    const formattedSigner = ethers.utils.getAddress(address)

    const handle = await KEYSTORE.get(formattedSigner)

    // format data
    const data = JSON.stringify({ handle: handle })

    const response = new Response(data, init, { status: 200 })
    response.headers.set('Access-Control-Allow-Origin', '*')
    response.headers.append('Vary', 'Origin')
    return response
}
