import { recoverTypedSignature_v4 } from 'eth-sig-util'
import { ethers } from 'ethers'
import { gatherResponse } from '../utils'
import { Octokit } from '@octokit/rest'
import { base64 } from 'ethers/lib/utils'
const { Base64 } = require('js-base64')

// github api info
const GIST_URL = 'https://api.github.com/gists/8f49a55280deaef631d360891a71e9c0'
const USER_AGENT = 'Cloudflare Worker'
const FILENAME = 'sybil-attestations.json'

const octokit = new Octokit({
    auth: '',
})

// format request for twitter api
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

// regex for parsing tweet
const reg = new RegExp('(?<=Signature:).*')

/**
 * @param {*} request
 * Accpets id=<tweet id>
 * Accepts account=<eth address> // just used to aler client of incorrect signer found
 *
 * 1. fetch tweet data using tweet id
 * 2. construct signature data using handle from tweet
 * 3. recover signer of signature from tweet
 * 4. if signer is the expected address, update gist with address -> handle mapping
 */
export async function handleVerify(request) {
    // get tweet id and account from url
    const { searchParams } = new URL(request.url)
    let tweetID = searchParams.get('id')
    let account = searchParams.get('account')

    // get tweet data from twitter api
    const twitterURL = `https://api.twitter.com/2/tweets?ids=${tweetID}&expansions=author_id&user.fields=username`
    requestOptions.headers.set('Origin', new URL(twitterURL).origin) // format for cors
    const twitterRes = await fetch(twitterURL, requestOptions)

    // parse the response from Twitter
    const twitterResponse = await gatherResponse(twitterRes)

    // if no tweet or author found, return error
    if (!twitterResponse.data || !twitterResponse.includes) {
        return new Response(null, {
            status: 400,
            statusText: 'Invalid tweet id',
        })
    }

    // get tweet text and handle
    const tweetContent = twitterResponse.data[0].text
    const handle = twitterResponse.includes.users[0].username

    // parse sig from tweet
    const matchedText = tweetContent.match(reg)

    // if no proper signature or handle data found, return error
    if (!twitterResponse.data || !twitterResponse.includes || !matchedText) {
        return new Response(null, {
            status: 400,
            statusText: 'Invalid tweet format',
        })
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
    const sig = matchedText[0].slice(0, 132)

    const signer = recoverTypedSignature_v4({
        data,
        sig,
    })

    // format with chekcsummed address
    const formattedSigner = ethers.utils.getAddress(signer)

    // if signer found is not the expected signer, alert client and dont update gist
    if (account !== formattedSigner) {
        return new Response(null, init, {
            status: 400,
            statusText: 'Invalid account',
        })
    }

    // initialize response
    let response

    const fileInfo = await fetch(
        'https://api.github.com/repos/ianlapham/other-test/contents/ian.json',
        {
            headers: {
                Authorization: 'token ' + GITHUB_AUTHENTICATION,
                'User-Agent': USER_AGENT,
            },
        }
    )
    const fileJSON = await fileInfo.json()
    const sha = fileJSON.sha

    // Decode the String as json object
    var decodedSybilList = JSON.parse(atob(fileJSON.content))
    decodedSybilList[formattedSigner] = {
        timestamp: Date.now(),
        tweetID,
        handle,
    }

    const stringData = JSON.stringify(decodedSybilList)

    const encodedData = btoa(stringData)

    await octokit.request('PUT /repos/ianlapham/other-test/contents/ian.json', {
        owner: 'ianlapham',
        repo: 'other-test',
        path: 'ian.json',
        message: 'message',
        sha,
        content: encodedData,
    })

    // // get current gist
    // const githubResponse = await fetch(GIST_URL, {
    //     headers: {
    //         Authorization: GITHUB_AUTHENTICATION,
    //         'User-Agent': USER_AGENT,
    //     },
    // })
    // const json = await githubResponse.json()
    // const payload = JSON.parse(json.files[FILENAME].content)

    // // add new handle to gist
    // payload[formattedSigner] = {
    //     timestamp: Date.now(),
    //     tweetID,
    //     handle,
    // }

    // // update gist with new file contents
    // let updateResponse = await fetch(GIST_URL, {
    //     headers: {
    //         Authorization: 'token ' + GITHUB_AUTHENTICATION,
    //         'User-Agent': USER_AGENT,
    //     },
    //     method: 'PATCH',
    //     body: JSON.stringify({
    //         files: {
    //             [FILENAME]: {
    //                 content: JSON.stringify(payload, undefined, 4),
    //                 filename: FILENAME,
    //             },
    //         },
    //     }),
    // })

    // if (updateResponse.status === 200) {
    //     // respond with handle if succesul update
    //     response = new Response(handle, init, {
    //         status: 200,
    //         statusText: 'Succesful verification',
    //     })
    // } else {
    //     response = new Response(null, init, {
    //         status: 400,
    //         statusText: 'Error updating gist',
    //     })
    // }

    response = new Response('ian', init, {
        status: 200,
        statusText: 'Succesful verification',
    })
    response.headers.set('Access-Control-Allow-Origin', '*')
    response.headers.append('Vary', 'Origin')
    return response
}
