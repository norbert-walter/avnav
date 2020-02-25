import React from "react";
import assign from "object-assign";
import widgetList from './WidgetList';
import Dynamic from '../hoc/Dynamic.jsx';
import DirectWidget from './DirectWidget.jsx';
import globalStore from '../util/globalstore.jsx';
import Formatter from '../util/formatter';
import Visible from '../hoc/Visible.jsx';
import ExternalWidget from './ExternalWidget.jsx';
import keys,{KeyHelper} from '../util/keys.jsx';
import Requests from '../util/requests.js';
import base from '../base.js';
import GaugeRadial from './GaugeRadial.jsx';

export class WidgetParameter{
    constructor(name,type,defaultv,list){
        this.name=name;
        this.type=type;
        this.default=defaultv;
        this.list=list;
        this.displayName=name;
    }
    getList(){
        if (typeof (this.list) === 'function') return this.list();
        return this.list||[];
    }
    setValue(widget,value){
        if (! widget) widget={};
        if (this.type == WidgetParameter.TYPE.DISPLAY) return widget;
        if (this.type !== WidgetParameter.TYPE.NUMBER || value === undefined) {
            widget[this.name] = value;
        }
        else{
            widget[this.name] = parseFloat(value);
        }
        return widget;
    }
    getValue(widget){
        return widget[this.name];
    }
    getValueForDisplay(widget,opt_placeHolder){
        let rt=this.getValue(widget);
        if (rt !== undefined) return rt;
        rt=this.default;
        if (rt !== undefined) return rt;
        return opt_placeHolder;
    }
    isValid(value){
        return true;
    }
    isChanged(value){
        return value !== this.default;
    }
}

WidgetParameter.TYPE={
    STRING:1,
    NUMBER:2,
    KEY:3,
    SELECT:4,
    DISPLAY: 5
};



class WidgetFactory{
    constructor(){
        this.createWidget=this.createWidget.bind(this);
        this.formatter=Formatter;
        this.widgetDefinitions=[];
        //create a copy of the widget list for adding/removing
        for (let k=0;k<widgetList.length;k++){
            this.widgetDefinitions.push(widgetList[k]);
        }
    }
    /**
     * find a complete widget description
     * @param widget - either a name or a widget description with a name field
     * @returns {*}
     */
    findWidget(widget){
        let i=this.findWidgetIndex(widget);
        if (i < 0) return undefined;
        return this.widgetDefinitions[i];
    }

    /**
     *
     * @param widget
     * @return {WidgetParameter[]|undefined}
     */
    getEditableWidgetParameters(widget){
        let widgetData=this.findWidget(widget);
        if (! widgetData) return[];
        let rt=[];
        let wClass=undefined;
        //simple approach: only DirectWidget...
        if ((! widgetData.wclass  && ! widgetData.children) || widgetData.wclass === DirectWidget || widgetData.wclass === ExternalWidget || widgetData.wclass.useDefaultOptions){
            rt.push(new WidgetParameter('caption',WidgetParameter.TYPE.STRING,widget.caption||widgetData.caption));
            rt.push(new WidgetParameter('unit',WidgetParameter.TYPE.STRING,widget.unit||widgetData.unit));
            let fmpar=new WidgetParameter('formatter', WidgetParameter.TYPE.SELECT,widget.formatter||widgetData.formatter);
            if (widgetData.formatter){
                let fname=widgetData.formatter;
                if (typeof(fname) === 'function') fname=fname.name;
                fmpar.default=fname;
                fmpar.type=WidgetParameter.TYPE.DISPLAY;
            }
            else{
                fmpar.list=()=>{
                    let fl=[];
                    for (let k in Formatter){
                        if (typeof(Formatter[k]) === 'function') fl.push(k);
                    }
                    return fl;
                }
            }
            rt.push(fmpar);
            let currentParameters=widget.formatterParameters||widgetData.formatterParameters;
            if (currentParameters instanceof Array){
                currentParameters=currentParameters.join(",");
            }
            let fpar=new WidgetParameter('formatterParameters',WidgetParameter.TYPE.STRING,currentParameters);
            fpar.displayName="formatter parameters";
            rt.push(fpar);
            wClass=widgetData.wclass||DirectWidget;
            let storeKeys=widgetData.storeKeys||wClass.storeKeys;
            if (! storeKeys){
                let spar=new WidgetParameter('value',WidgetParameter.TYPE.KEY,widget.storeKeys?widget.storeKeys.value:undefined);
                spar.list=()=>{
                    let kl=KeyHelper.getValueKeys().slice(0);
                    //TODO: better + generic
                    kl=kl.concat(globalStore.getKeysByPrefix('nav.gps.signalk'));
                    return kl;
                };
                spar.setValue=(widget,value)=>{
                    if (! widget) widget={};
                    if (!widget.storeKeys) widget.storeKeys={};
                    widget.storeKeys.value=value;
                    return widget;
                };
                spar.getValue=(widget)=>{
                    if (!widget) return;
                    if (!widget.storeKeys) return;
                    return widget.storeKeys.value;
                };
                rt.push(spar)
            }
        }
        let cpar=new WidgetParameter("className",WidgetParameter.TYPE.STRING,widget.className||widgetData.className);
        cpar.displayName="css class";
        rt.push(cpar);
        let editableParameters=widgetData.editableParameters||(wClass?wClass.editableParameters:undefined);
        if (!editableParameters) return rt;
        let filtered=[];
        rt.forEach((p)=>{
            if (p.name==='className' || editableParameters[p.name]){
                filtered.push(p);
            }
        });
        return filtered;
    }


    /**
     * find the index for a widget
     * @param widget - either a name or a widget description with a name field
     * @returns {number} - -1 omn error
     */
    findWidgetIndex(widget){
        if (widget === undefined) return -1;
        let search=widget;
        if (typeof(widget) !== "string"){
            search=widget.name;
        }
        for (let i=0;i<this.widgetDefinitions.length;i++) {
            let e = this.widgetDefinitions[i];
            if ((e.name !== undefined && e.name == search ) || (e.caption == search)) {
                return i;
            }
        }
        return -1;
    }

    createWidget(props, opt_properties) {
        let self = this;
        if (!props.name) return;
        let e = this.findWidget(props.name);
        if (!e ) {
            return;
        }
        let mergedProps = assign({}, e, props, opt_properties);
        if (mergedProps.key === undefined) mergedProps.key = props.name;
        if (mergedProps.formatter) {
            if (typeof mergedProps.formatter === 'string') {
                let ff = this.formatter[mergedProps.formatter];
                if (typeof ff !== 'function') {
                    throw new Error("invalid formatter " + mergedProps.formatter)
                }
                mergedProps.formatter = function (v) {
                    let param=mergedProps.formatterParameters;
                    if (typeof(param) === 'string'){
                        param=param.split(",");
                    }
                    return ff.apply(self.formatter, [v].concat(param || []));
                }
            }
        }
        return function (props) {
            let wprops = assign({}, props, mergedProps);
            let {style,...childProperties}=opt_properties||{}; //filter out style for children
            if (mergedProps.children) {
                let cidx=0;
                return <div {...mergedProps} className="widget combinedWidget" >
                    {mergedProps.children.map((item)=> {
                        let Item = self.createWidget(item, childProperties);
                        cidx++;
                        return <Item key={cidx} onClick={wprops.onClick}/>
                    })}
                </div>
            }
            else {
                let RenderWidget = mergedProps.wclass || DirectWidget;
                let storeKeys = mergedProps.storeKeys;
                if (wprops.className) wprops.className+=" "+wprops.name;
                else wprops.className=wprops.name;
                if (!storeKeys) {
                    storeKeys = RenderWidget.storeKeys;
                }
                if (wprops.handleVisible){
                    RenderWidget=Visible(RenderWidget);
                    delete wprops.handleVisible;
                }
                if (storeKeys) {
                    RenderWidget = Dynamic(RenderWidget, {storeKeys:storeKeys});
                }
                return <RenderWidget {...wprops}/>
            }
        };
    }
    getWidget(index){
        if (index < 0 || index >= this.widgetDefinitions.length) return undefined;
        let el=assign({},this.widgetDefinitions[index]);
        if (el.name === undefined) el.name=el.caption;
        if (el.description === undefined)el.description=el.name;
        return el;
    }
    getAvailableWidgets(){
        let rt=[];
        for (let i=0;i< this.widgetDefinitions.length;i++){
            let el=this.getWidget(i);
            rt.push(el);
        }
        return rt;
    }
    addWidget(definition,ignoreExisting){
        if (! definition) throw new Error("missing parameter definition");
        if (! definition.name) throw new Error("missing parameter name");
        let existing=this.findWidgetIndex(definition);
        if (existing >= 0 ) {
            if (! ignoreExisting) throw new Error("widget " + definition.name + " already exists");
            this.widgetDefinitions[existing]=definition;
        }
        this.widgetDefinitions.push(definition);
    }
    registerExternalWidget(description){
        let reservedParameters=['onClick','wclass'];
        let forbiddenKeys=['name'].concat(reservedParameters);
        let internalDescription=assign({},description);
        if (internalDescription.renderHtml || internalDescription.renderCanvas){
            //we should use our external widget
            if (internalDescription.renderHtml && typeof(internalDescription.renderHtml) !== 'function'){
                throw new Error("renderHtml must be a function");
            }
            if (internalDescription.renderCanvas && typeof(internalDescription.renderCanvas) !== 'function'){
                throw new Error("renderCanvas must be a function");
            }
            internalDescription.wclass=ExternalWidget;
        }
        else{
            if (! internalDescription.formatter){
                throw new Error("formatter must be set for the default widget");
            }
        }
        reservedParameters.forEach((p)=>{
           if (description[p]){
               throw new Error("you cannot set the reserved parameter "+p);
           }
        });
        if (description.storeKeys){
            forbiddenKeys.forEach((k)=>{
                if (description.storeKeys[k]){
                    throw new Error("you cannot set the reserved parameter "+k+" as a storeKey");
                }
            })
        }
        this.addWidget(internalDescription);
    }
}
/**
 * filter a list of widget descriptiion by name
 * @param list the list
 * @param filterObject an object with {'name1':true,'name2':false} entries
 *        missing entries are treated as true
 */
WidgetFactory.prototype.filterListByName=function(list,filterObject){
    let rt=[];
    list.forEach((el)=>{
        if (el.name) {
            if (filterObject[el.name] !== false){
                rt.push(el);
            }
        }
    });
    return rt;
};

WidgetFactory.prototype.loadGaugeDefinitions=function(name,prefix,wclass){
    let self=this;
    let urls=[name+".json","/user/viewer/"+name+".json"];
    urls.forEach((url)=>{
        Requests.getJson(url,{useNavUrl:false,checkOk:false})
            .then((data)=>{
                for (let gName in data){
                    let description=data[gName];
                    description.name=prefix+"."+gName;
                    description.wclass=wclass;
                    let existing=self.findWidget(description);
                    if (existing){
                        if (existing.wclass !== description.wclass){
                            base.log("ignoring widget "+description.name+": already exists with different class");
                            return;
                        }
                    }
                    self.addWidget(description);
                }
            })
            .catch((error)=>{
                base.log("unable to read widget list "+url+": "+error);
            })
    })
};

WidgetFactory.prototype.loadAllGaugeDefinitions=function(){
    let self=this;
    let list=[
        {name:'radialGauges',prefix:'radGauge',wclass:GaugeRadial}
    ];
    list.forEach((le)=>{
        self.loadGaugeDefinitions(le.name,le.prefix,le.wclass);
    })
};


export default new WidgetFactory();